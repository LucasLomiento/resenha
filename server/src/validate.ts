// Validação de tudo que vem de fora. O app nunca é confiável: cada campo é
// conferido aqui antes de ir pro banco.

import type { MusicStatus } from '../../shared/protocol'

// Caracteres de controle e invisíveis (espaço de largura zero, troca de direção
// do texto, separadores de linha, os "preenchimentos" do hangul e do braille…),
// usados pra disfarçar nomes. O ZWJ (U+200D) fica: ele monta emoji compostos.
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u2800\u3164\ufeff\uffa0]/g
const INVISIBLE_KEEP_LINES =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u2800\u3164\ufeff\uffa0]/g
/** Pelo menos uma letra, número, pontuação ou símbolo (emoji conta): nome só de espaço e acento solto não passa. */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u

/** Texto livre de uma linha: sem caracteres de controle, espaços normalizados. */
export function cleanLine(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  if (min > 0 && !VISIBLE.test(text)) return null
  return text.length >= min && text.length <= max ? text : null
}

/** Nome de arquivo: sem controle, invisível (a troca de direção disfarça um ".exe" de ".png") nem barra. */
export function cleanFileName(value: string): string {
  return value.replace(INVISIBLE, '').replace(/[/\\]/g, '_').trim().slice(0, 200) || 'arquivo'
}

/** Texto de várias linhas (bio, tópico): tira controle mas mantém quebras. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(INVISIBLE_KEEP_LINES, '').replace(/\n{3,}/g, '\n\n').trim()
  return text.length <= max ? text : null
}

const RESERVED = new Set([
  'admin', 'administrador', 'resenha', 'system', 'sistema', 'everyone', 'here', 'suporte', 'support',
  'moderador', 'moderator', 'staff', 'root', 'null', 'undefined', 'deleted', 'excluido',
])

/** Nome de usuário: 2 a 32 de [a-z0-9_.], sem ponto no começo/fim nem dois seguidos. */
export function username(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()
  if (!/^[a-z0-9_.]{2,32}$/.test(name) || /^\.|\.$|\.\./.test(name) || RESERVED.has(name)) return null
  return name
}

/** Converte um apelido antigo (com espaço, acento…) num nome de usuário válido. */
export function slugUsername(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 32)
  return base.length >= 2 ? base : `user_${base}`.slice(0, 32)
}

export function color(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffff) return undefined
  return value
}

export function int(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

export function id(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : null
}

/** Senha: 8 a 256 caracteres, fora da lista das mais usadas e diferente do usuário. */
export function passwordProblem(password: unknown, user: string): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.'
  if (password.length > 256) return 'A senha pode ter no máximo 256 caracteres.'
  const lower = password.toLowerCase()
  if (lower === user.toLowerCase() || COMMON.has(lower)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.'
  if (/^(.)\1+$/.test(password)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.'
  return null
}

// As senhas mais vazadas (lista curta, cobre a maior parte dos chutes automáticos).
const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'senha123', 'senha1234', 'qwerty123', 'qwertyuiop',
  '11111111', '00000000', '12341234', '87654321', 'abc12345', 'abcd1234', 'iloveyou', 'princess', 'sunshine',
  'football', 'baseball', 'superman', 'batman123', 'welcome1', 'admin123', 'administrador', 'flamengo', 'corinthians',
  'palmeiras', 'saopaulo', 'vasco123', 'gremio123', 'brasil123', 'mudar123', 'trocar123', 'senhasenha', 'minhasenha',
  'teste123', 'testando', 'qazwsxedc', '1q2w3e4r', '1q2w3e4r5t', 'zaq12wsx', 'asdfghjkl', 'aaaaaaaa', 'passw0rd',
  'p@ssw0rd', 'letmein1', 'dragon123', 'monkey123', 'master123', 'shadow123', 'michael1', 'jordan23', 'charlie1',
])

/** O que o bot do Spotify de alguém está tocando (só texto curto, pra lista do canal de voz). */
export function cleanMusic(value: unknown): MusicStatus | null {
  if (!value || typeof value !== 'object') return null
  const music = value as Record<string, unknown>
  const line = (text: unknown) => (typeof text === 'string' ? (cleanLine(text.slice(0, 200), 0, 200) ?? '') : '')
  return { title: line(music.title), artist: line(music.artist), playing: music.playing === true }
}
