#!/usr/bin/env python3
# Rabiscos do Resenha por cima da tela de quem compartilha (Linux/Wayland).
#
# Uma camada transparente (layer-shell, na camada "overlay": fica por cima de
# tudo, até de jogo em tela cheia) num monitor só, que não pega clique nem
# teclado. Como ela está no monitor que está sendo transmitido, quem assiste vê
# os rabiscos na própria transmissão.
#
# Recebe os rabiscos pela entrada padrão, uma linha JSON por evento, com as
# posições de 0 a 1 em relação ao monitor inteiro (a resolução de quem assiste
# não importa). Quando a entrada fecha (o app saiu), sai junto.
#
#   ink-overlay.py --list          lista os monitores (JSON) e sai
#   ink-overlay.py <conector>      abre a camada nesse monitor (ex.: DP-1)
#   ink-overlay.py --render <png>  desenha uma cena de teste numa imagem (sem tela)
#
# Precisa de gtk4, gtk4-layer-shell e python-gobject. O libgtk4-layer-shell tem
# que ser carregado antes do Wayland (LD_PRELOAD); o app já abre assim.

import json
import math
import sys
import time

import cairo
import gi

gi.require_version('Gtk', '4.0')
gi.require_version('Gdk', '4.0')
from gi.repository import Gdk, Gio, GLib, Gtk  # noqa: E402

# Quadradinho de teste (em pixels lógicos, no canto de cima à esquerda). Tem que bater com PROBE em lib/ink.svelte.ts.
PROBE_SIZE = 48
PROBE_COLOR = (1.0, 0.0, 1.0)
# Caneta: fica até uns segundos depois de soltar e some devagar (como no Slack).
PEN_LIFE = 6.0
PEN_FADE = 0.8
# Laser: só o rastro do último instante.
LASER_TRAIL = 0.7
PING_LIFE = 0.9
# Nome de quem está rabiscando, perto da ponta, enquanto mexe.
NAME_LIFE = 1.6
MAX_STROKES = 200
MAX_POINTS = 4000


def parse_color(text):
    try:
        text = text.lstrip('#')
        return tuple(int(text[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except (ValueError, AttributeError):
        return (0.68, 0.64, 1.0)


def clamp(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    return min(1.0, max(0.0, value))


class Scene:
    """O que está na tela agora: traços (caneta e laser) e pings."""

    def __init__(self):
        self.strokes = {}
        self.pings = []
        # Quadradinho no canto: o app procura ele na captura pra saber qual monitor está sendo transmitido.
        self.probe = False

    def handle(self, event, now):
        kind = event.get('t')
        if kind == 'stroke':
            sid = str(event.get('id', ''))[:40]
            stroke = self.strokes.get(sid)
            if stroke is None:
                if len(self.strokes) >= MAX_STROKES:
                    oldest = min(self.strokes, key=lambda k: self.strokes[k]['updated'])
                    del self.strokes[oldest]
                stroke = {
                    'tool': 'laser' if event.get('tool') == 'laser' else 'pen',
                    'color': parse_color(event.get('color', '')),
                    'name': str(event.get('name', ''))[:40],
                    'author': str(event.get('author', ''))[:40],
                    'points': [],
                    'ended': None,
                    'updated': now,
                }
                self.strokes[sid] = stroke
            flat = event.get('points') or []
            for i in range(0, min(len(flat), 2 * 400) - 1, 2):
                x, y = clamp(flat[i]), clamp(flat[i + 1])
                if x is not None and y is not None and len(stroke['points']) < MAX_POINTS:
                    stroke['points'].append((x, y, now))
            stroke['updated'] = now
            if event.get('end'):
                stroke['ended'] = now
        elif kind == 'ping':
            x, y = clamp(event.get('x')), clamp(event.get('y'))
            if x is not None and y is not None:
                self.pings.append({'x': x, 'y': y, 'at': now, 'color': parse_color(event.get('color', '')), 'name': str(event.get('name', ''))[:40]})
                self.pings = self.pings[-50:]
        elif kind == 'probe':
            self.probe = event.get('on') is True
        elif kind == 'clear':
            author = event.get('author')
            if author:
                self.strokes = {k: s for k, s in self.strokes.items() if s['author'] != author}
            else:
                self.strokes.clear()
                self.pings.clear()

    def prune(self, now):
        for sid in list(self.strokes):
            s = self.strokes[sid]
            if s['tool'] == 'laser':
                gone = s['ended'] is not None and now - s['ended'] > LASER_TRAIL
                # Laser sem "fim" (a conexão caiu no meio): some sozinho.
                gone = gone or now - s['updated'] > 5
            else:
                last = s['ended'] if s['ended'] is not None else s['updated']
                gone = now - last > PEN_LIFE + PEN_FADE + (0 if s['ended'] is not None else 30)
            if gone:
                del self.strokes[sid]
        self.pings = [p for p in self.pings if now - p['at'] < PING_LIFE]

    @property
    def busy(self):
        return bool(self.strokes or self.pings or self.probe)

    def draw(self, cr, width, height, now):
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        unit = max(1.0, min(width, height) / 1080)
        if self.probe:
            cr.set_source_rgb(*PROBE_COLOR)
            cr.rectangle(0, 0, PROBE_SIZE, PROBE_SIZE)
            cr.fill()
        for s in self.strokes.values():
            if s['tool'] == 'laser':
                self.draw_laser(cr, s, width, height, now, unit)
            else:
                self.draw_pen(cr, s, width, height, now, unit)
        for p in self.pings:
            self.draw_ping(cr, p, width, height, now, unit)
        for s in self.strokes.values():
            if s['points'] and now - s['updated'] < NAME_LIFE and s['name']:
                x, y, _ = s['points'][-1]
                alpha = 1.0 if s['tool'] == 'pen' or s['ended'] is None else max(0.0, 1 - (now - s['ended']) / LASER_TRAIL)
                self.draw_name(cr, s['name'], s['color'], x * width, y * height, unit, alpha)

    def draw_pen(self, cr, s, width, height, now, unit):
        pts = s['points']
        if not pts:
            return
        alpha = 1.0
        if s['ended'] is not None:
            age = now - s['ended']
            if age > PEN_LIFE:
                alpha = max(0.0, 1 - (age - PEN_LIFE) / PEN_FADE)
        if alpha <= 0:
            return
        if len(pts) == 1:
            x, y, _ = pts[0]
            cr.set_source_rgba(*s['color'], alpha)
            cr.arc(x * width, y * height, 3.2 * unit, 0, 2 * math.pi)
            cr.fill()
            return
        for line_width, color in ((8.0 * unit, (0, 0, 0, 0.45 * alpha)), (4.8 * unit, (*s['color'], alpha))):
            cr.set_line_width(line_width)
            cr.set_source_rgba(*color)
            cr.move_to(pts[0][0] * width, pts[0][1] * height)
            for x, y, _ in pts[1:]:
                cr.line_to(x * width, y * height)
            cr.stroke()

    def draw_laser(self, cr, s, width, height, now, unit):
        live = [p for p in s['points'] if now - p[2] < LASER_TRAIL]
        if not live:
            return
        # Brilho: traço largo e fraco por baixo, fino e forte por cima, sumindo na cauda.
        for i in range(1, len(live)):
            x0, y0, t0 = live[i - 1]
            x1, y1, t1 = live[i]
            fade = max(0.0, 1 - (now - t1) / LASER_TRAIL)
            for line_width, alpha in ((14 * unit, 0.18), (5.5 * unit, 0.95)):
                cr.set_line_width(line_width * (0.4 + 0.6 * fade))
                cr.set_source_rgba(*s['color'], alpha * fade)
                cr.move_to(x0 * width, y0 * height)
                cr.line_to(x1 * width, y1 * height)
                cr.stroke()
        x, y, _ = live[-1]
        cr.set_source_rgba(1, 1, 1, 0.95)
        cr.arc(x * width, y * height, 3.4 * unit, 0, 2 * math.pi)
        cr.fill()

    def draw_ping(self, cr, p, width, height, now, unit):
        t = (now - p['at']) / PING_LIFE
        x, y = p['x'] * width, p['y'] * height
        for delay in (0.0, 0.25):
            k = (t - delay) / (1 - delay)
            if k <= 0:
                continue
            radius = (10 + 70 * (1 - (1 - k) ** 3)) * unit
            cr.set_line_width(4 * unit)
            cr.set_source_rgba(*p['color'], max(0.0, 1 - k))
            cr.arc(x, y, radius, 0, 2 * math.pi)
            cr.stroke()
        cr.set_source_rgba(*p['color'], max(0.0, 1 - t))
        cr.arc(x, y, 7 * unit, 0, 2 * math.pi)
        cr.fill()
        if p['name']:
            self.draw_name(cr, p['name'], p['color'], x + 6 * unit, y - 40 * unit, unit, max(0.0, 1 - t))

    def draw_name(self, cr, name, color, x, y, unit, alpha):
        if alpha <= 0:
            return
        cr.select_font_face('Sans', cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        cr.set_font_size(13 * unit)
        ext = cr.text_extents(name)
        pad_x, pad_y = 7 * unit, 4 * unit
        w, h = ext.width + 2 * pad_x, 13 * unit + 2 * pad_y
        left, top = x + 12 * unit, y + 12 * unit
        radius = h / 2
        cr.new_sub_path()
        cr.arc(left + w - radius, top + radius, radius, -math.pi / 2, math.pi / 2)
        cr.arc(left + radius, top + radius, radius, math.pi / 2, 3 * math.pi / 2)
        cr.close_path()
        cr.set_source_rgba(*color, 0.95 * alpha)
        cr.fill()
        cr.set_source_rgba(0.05, 0.04, 0.09, 0.9 * alpha)
        cr.move_to(left + pad_x - ext.x_bearing, top + pad_y + 13 * unit * 0.8)
        cr.show_text(name)


def list_monitors():
    Gtk.init()
    display = Gdk.Display.get_default()
    out = []
    if display is not None:
        monitors = display.get_monitors()
        for i in range(monitors.get_n_items()):
            m = monitors.get_item(i)
            g = m.get_geometry()
            out.append({
                'connector': m.get_connector() or f'monitor-{i}',
                'name': m.get_description() or m.get_model() or m.get_connector() or f'Monitor {i + 1}',
                'x': g.x,
                'y': g.y,
                'width': g.width,
                'height': g.height,
            })
    print(json.dumps(out))


def render_test(path):
    """Desenha uma cena de exemplo numa imagem: confere o visual sem abrir nada na tela."""
    width, height = 1280, 720
    scene = Scene()
    now = time.monotonic()
    pen = [v for i in range(41) for v in (0.18 + 0.3 * i / 40, 0.3 + 0.12 * math.sin(i / 6))]
    scene.handle({'t': 'stroke', 'id': 'a', 'tool': 'pen', 'color': '#ff7a93', 'name': 'Duarte', 'author': 'b', 'points': pen}, now - 0.5)
    scene.handle({'t': 'stroke', 'id': 'a', 'end': True}, now - 0.2)
    scene.handle({'t': 'stroke', 'id': 'l', 'tool': 'laser', 'color': '#48b9ff', 'name': 'Lucas', 'author': 'a',
                  'points': []}, now)
    for i in range(30):
        t = now - 0.6 + i * 0.02
        scene.handle({'t': 'stroke', 'id': 'l', 'points': [0.55 + 0.25 * i / 30, 0.62 - 0.2 * math.sin(i / 9)]}, t)
    scene.handle({'t': 'ping', 'x': 0.78, 'y': 0.28, 'color': '#36d6ad', 'name': 'Zé'}, now - 0.3)
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    cr = cairo.Context(surface)
    cr.set_source_rgb(0.12, 0.13, 0.17)
    cr.paint()
    scene.draw(cr, width, height, now)
    surface.write_to_png(path)


def run(connector):
    gi.require_version('Gtk4LayerShell', '1.0')
    from gi.repository import Gtk4LayerShell as LayerShell

    scene = Scene()
    app = Gtk.Application(flags=Gio.ApplicationFlags.NON_UNIQUE)
    state = {'tick': None, 'area': None}

    def now():
        return time.monotonic()

    def on_tick(_widget, _clock):
        scene.prune(now())
        state['area'].queue_draw()
        if not scene.busy:
            state['tick'] = None
            return GLib.SOURCE_REMOVE
        return GLib.SOURCE_CONTINUE

    def wake():
        if state['tick'] is None and state['area'] is not None:
            state['tick'] = state['area'].add_tick_callback(on_tick)

    def draw(_area, cr, width, height):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        scene.draw(cr, width, height, now())

    def click_through(window):
        surface = window.get_surface()
        if surface is not None:
            surface.set_input_region(cairo.Region())

    def on_activate(application):
        if not LayerShell.is_supported():
            print(json.dumps({'error': 'unsupported'}), flush=True)
            application.quit()
            return
        display = Gdk.Display.get_default()
        monitors = display.get_monitors()
        monitor = None
        for i in range(monitors.get_n_items()):
            m = monitors.get_item(i)
            if m.get_connector() == connector:
                monitor = m
        if monitor is None:
            print(json.dumps({'error': 'monitor'}), flush=True)
            application.quit()
            return

        css = Gtk.CssProvider()
        css.load_from_string('window, window.background { background: transparent; }')
        Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        window = Gtk.Window(application=application)
        window.set_decorated(False)
        LayerShell.init_for_window(window)
        LayerShell.set_namespace(window, 'resenha-rabiscos')
        LayerShell.set_layer(window, LayerShell.Layer.OVERLAY)
        LayerShell.set_monitor(window, monitor)
        for edge in (LayerShell.Edge.TOP, LayerShell.Edge.BOTTOM, LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT):
            LayerShell.set_anchor(window, edge, True)
        LayerShell.set_exclusive_zone(window, -1)
        LayerShell.set_keyboard_mode(window, LayerShell.KeyboardMode.NONE)

        area = Gtk.DrawingArea()
        area.set_draw_func(draw)
        area.set_can_target(False)
        window.set_child(area)
        state['area'] = area

        # Clique e teclado passam direto pro que está embaixo (o jogo, o desktop).
        window.connect('realize', lambda w: click_through(w))
        window.connect('map', lambda w: click_through(w))
        window.present()
        click_through(window)
        surface = window.get_surface()
        if surface is not None:
            surface.connect('layout', lambda *_: click_through(window))
        print(json.dumps({'ready': connector}), flush=True)

        stream = Gio.DataInputStream.new(Gio.UnixInputStream.new(0, False))

        def on_line(source, result):
            try:
                line, _ = source.read_line_finish_utf8(result)
            except GLib.Error:
                line = None
            if line is None:
                application.quit()
                return
            try:
                event = json.loads(line)
            except ValueError:
                event = None
            if isinstance(event, dict):
                if event.get('t') == 'quit':
                    application.quit()
                    return
                scene.handle(event, now())
                wake()
            source.read_line_async(GLib.PRIORITY_DEFAULT, None, on_line)

        stream.read_line_async(GLib.PRIORITY_DEFAULT, None, on_line)

    app.connect('activate', on_activate)
    app.hold()
    app.run([sys.argv[0]])


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == '--list':
        list_monitors()
    elif len(sys.argv) >= 3 and sys.argv[1] == '--render':
        render_test(sys.argv[2])
    elif len(sys.argv) >= 2:
        run(sys.argv[1])
    else:
        print('uso: ink-overlay.py --list | <conector> | --render <png>', file=sys.stderr)
        sys.exit(2)
