// Imagem quadrada pequena (foto de perfil, ícone de servidor) feita no app,
// antes de enviar: o servidor só aceita até 512 KB.

/** Limite do servidor pra foto e ícone. */
export const MAX_IMAGE_BYTES = 512 * 1024

/**
 * Corta no centro (quadrado), reduz pra `size` px (nunca aumenta) e codifica
 * em WebP abaixo de `maxBytes`. GIF animado vira imagem parada.
 */
export async function squareImage(file: Blob, size = 256, maxBytes = MAX_IMAGE_BYTES): Promise<Blob> {
  let full: ImageBitmap
  try {
    full = await createImageBitmap(file)
  } catch {
    throw new Error('Não deu pra abrir essa imagem. Use PNG, JPEG, WebP ou GIF.')
  }
  const side = Math.min(full.width, full.height)
  const out = Math.max(1, Math.min(size, side))
  const square = await createImageBitmap(full, Math.floor((full.width - side) / 2), Math.floor((full.height - side) / 2), side, side, {
    resizeWidth: out,
    resizeHeight: out,
    resizeQuality: 'high',
  })
  full.close()
  const canvas = new OffscreenCanvas(out, out)
  canvas.getContext('2d')!.drawImage(square, 0, 0)
  square.close()
  for (const quality of [0.9, 0.8, 0.65, 0.5]) {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
    if (blob.size <= maxBytes) return blob
  }
  throw new Error('A imagem ficou grande demais. Tente outra.')
}
