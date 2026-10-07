// Imagens do perfil e do servidor feitas no app, antes de enviar: foto e
// ícone quadrados (até 512 KB), banner largo e foto animada (até 1,5 MB).

import { MAX_ANIMATED_BYTES, MAX_AVATAR_BYTES, MAX_BANNER_BYTES } from '../../../../shared/protocol'
import { isAnimated } from '../../../../shared/media'

/** Limite do servidor pra foto e ícone. */
export const MAX_IMAGE_BYTES = MAX_AVATAR_BYTES

async function open(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error('Não deu pra abrir essa imagem. Use PNG, JPEG, WebP ou GIF.')
  }
}

async function webp(canvas: OffscreenCanvas, maxBytes: number): Promise<Blob> {
  for (const quality of [0.9, 0.8, 0.65, 0.5]) {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
    if (blob.size <= maxBytes) return blob
  }
  throw new Error('A imagem ficou grande demais. Tente outra.')
}

/**
 * Corta no centro (quadrado), reduz pra `size` px (nunca aumenta) e codifica
 * em WebP abaixo de `maxBytes`. GIF animado vira imagem parada (o primeiro quadro).
 */
export async function squareImage(file: Blob, size = 256, maxBytes = MAX_IMAGE_BYTES): Promise<Blob> {
  const full = await open(file)
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
  return webp(canvas, maxBytes)
}

/** GIF ou WebP animado? (Olha os bytes, igual o servidor.) */
export async function animatedImage(file: Blob): Promise<boolean> {
  if (!/^image\/(gif|webp)$/.test(file.type)) return false
  return isAnimated(new Uint8Array(await file.arrayBuffer()))
}

/**
 * Foto de perfil: parada vira WebP quadrado de 256 px; animada vai como está
 * (até 1,5 MB), com o primeiro quadro parado pras listas.
 */
export async function avatarImages(file: File): Promise<{ image: Blob; still: Blob | null }> {
  if (!(await animatedImage(file))) return { image: await squareImage(file, 256), still: null }
  if (file.size > MAX_ANIMATED_BYTES) throw new Error('A foto animada pode ter até 1,5 MB.')
  return { image: file, still: await squareImage(file, 256) }
}

/** Banner: 5:2, até 1200 px de largura, em WebP. Animado vai como está (até 1,5 MB). */
export async function bannerImage(file: File): Promise<Blob> {
  if (await animatedImage(file)) {
    if (file.size > MAX_BANNER_BYTES) throw new Error('O banner animado pode ter até 1,5 MB.')
    return file
  }
  const full = await open(file)
  // Corta no centro pra 5:2 (o que aparece no cartão).
  const width = Math.min(full.width, Math.round(full.height * 2.5))
  const height = Math.round(width / 2.5)
  const outWidth = Math.min(1200, width)
  const outHeight = Math.max(1, Math.round(outWidth / 2.5))
  const crop = await createImageBitmap(full, Math.floor((full.width - width) / 2), Math.floor((full.height - height) / 2), width, height, {
    resizeWidth: outWidth,
    resizeHeight: outHeight,
    resizeQuality: 'high',
  })
  full.close()
  const canvas = new OffscreenCanvas(outWidth, outHeight)
  canvas.getContext('2d')!.drawImage(crop, 0, 0)
  crop.close()
  return webp(canvas, MAX_BANNER_BYTES)
}
