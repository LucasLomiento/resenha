import type pt from '../pt/kit'

export default {
  colorPicker: {
    label: 'Color',
    area: 'Saturación y brillo',
    hue: 'Tono',
    code: 'Código del color',
  },
  meter: {
    label: 'Nivel del micrófono',
    threshold: 'Sensibilidad',
  },
  signal: {
    measuring: 'Midiendo la conexión…',
    relay: (rtt: number) => `${rtt} ms · por el servidor (relay)`,
    direct: (rtt: number) => `${rtt} ms · conexión directa`,
  },
  badge: {
    founder: 'Fundador de Resenha',
    pioneer: 'Mejor amigo del dueño de Resenha, el tipo más crack que conocí. A veces demasiado enojado, a veces demasiado puta.',
  },
} satisfies typeof pt
