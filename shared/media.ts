// Detecção de imagem animada, igual no app (que decide se manda o quadro
// parado junto) e no servidor (que exige o quadro parado). Sem dependência de
// Node, DOM ou Workers.

/** Foto animada? (GIF com mais de um quadro, WebP com a marca de animação.) */
export function isAnimated(bytes: Uint8Array): boolean {
  // WebP estendido: "VP8X" no byte 12 e o bit de animação nas flags (byte 20).
  if (bytes[0] === 0x52 && bytes[8] === 0x57 && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
    return (bytes[20] & 0x02) !== 0
  }
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return false
  // GIF: mais de um bloco de controle de quadro (21 F9 04).
  let frames = 0
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++frames > 1) return true
  }
  return false
}
