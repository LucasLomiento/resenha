#!/bin/bash
# Gera os PNGs e o .ico a partir dos SVGs desta pasta (precisa de rsvg-convert e magick).
#   icon.svg           -> icon.png (512, Linux) e os tamanhos grandes do .ico (48 a 256)
#   icon-16/24/32.svg  -> tamanhos pequenos do .ico, desenhados na grade de pixels
#   tray*.svg          -> bandeja: 32 px e @2x (64 px, o que o Electron manda pro tray do Linux)
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

rsvg-convert -w 512 -h 512 icon.svg -o icon.png
for s in 16 24 32; do rsvg-convert -w $s -h $s icon-$s.svg -o "$tmp/$s.png"; done
for s in 48 64 128 256; do rsvg-convert -w $s -h $s icon.svg -o "$tmp/$s.png"; done
magick "$tmp"/{16,24,32,48,64,128,256}.png icon.ico

for n in tray tray-speaking tray-muted tray-deafened; do
  rsvg-convert -w 32 -h 32 $n.svg -o $n.png
  rsvg-convert -w 64 -h 64 $n.svg -o $n@2x.png
done
