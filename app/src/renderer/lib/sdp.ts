// Ajustes pontuais no SDP *remoto* (o que chega do outro lado). Mexer no SDP
// local está sendo descontinuado pelo Chromium; no remoto é só texto que
// chegou pela rede.

const SCREEN_OPUS = {
  stereo: '1',
  'sprop-stereo': '1',
  maxaveragebitrate: '128000',
  useinbandfec: '1',
}

function mergeFmtp(existing: string, extra: Record<string, string>): string {
  const params = new Map<string, string>()
  for (const part of existing.split(';')) {
    const [key, value] = part.split('=')
    if (key?.trim()) params.set(key.trim(), (value ?? '').trim())
  }
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return [...params].map(([k, v]) => (v ? `${k}=${v}` : k)).join(';')
}

/**
 * Pro áudio da tela (música, jogo, vídeo) sair em estéreo e com qualidade, o
 * lado que RECEBE precisa anunciar stereo=1 e um bitrate maior. Quem
 * compartilha aplica isso na descrição que recebe, só nas seções (mids) do
 * áudio da tela; a voz continua no padrão do Opus.
 */
export function tuneScreenOpus(sdp: string, mids: Set<string>): string {
  if (mids.size === 0 || !sdp) return sdp
  return sdp
    .split(/(?=\r\nm=)/)
    .map((section) => {
      const mid = section.match(/\r\na=mid:(\S+)/)?.[1]
      if (!mid || !mids.has(mid)) return section
      const pt = section.match(/\r\na=rtpmap:(\d+) opus\/48000\/2/i)?.[1]
      if (!pt) return section
      const fmtp = new RegExp(`\\r\\na=fmtp:${pt} ([^\\r\\n]*)`)
      if (fmtp.test(section)) {
        return section.replace(fmtp, (_, existing: string) => `\r\na=fmtp:${pt} ${mergeFmtp(existing, SCREEN_OPUS)}`)
      }
      return section.replace(
        new RegExp(`(\\r\\na=rtpmap:${pt} [^\\r\\n]*)`),
        `$1\r\na=fmtp:${pt} ${mergeFmtp('', SCREEN_OPUS)}`,
      )
    })
    .join('')
}
