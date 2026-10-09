// Mensagens do servidor com partes que variam (tamanho, nome, número): o padrão em
// português e a chave em `m.errors.dynamic`, que recebe os pedaços capturados.
import type pt from './pt/errors'

type DynamicKey = keyof (typeof pt)['dynamic']

export const SERVER_PATTERNS: { re: RegExp; key: DynamicKey }[] = [
  { re: /^Muitas tentativas\. Tente de novo em (\d+) minutos\.$/, key: 'tryAgainInMinutes' },
  { re: /^A imagem pode ter até (.+)\.$/, key: 'imageTooBig' },
  { re: /^Antes, transfira ou exclua seus servidores: (.+)\.$/s, key: 'ownsServers' },
  { re: /^Você já está em (\d+) servidores\.$/, key: 'serverLimit' },
  { re: /^Esse canal já tem (\d+) mensagens fixadas\.$/, key: 'pinLimit' },
  { re: /^Modo lento: espere (\d+) s pra mandar outra mensagem\.$/, key: 'slowMode' },
  { re: /^O limite é de (\d+) canais\.$/, key: 'channelLimit' },
  { re: /^O limite é de (\d+) canais por servidor\.$/, key: 'channelLimitPerServer' },
  { re: /^O limite é de (\d+) cargos\.$/, key: 'roleLimit' },
  { re: /^O mapa já tem (\d+) marcadores\. Apague algum antes\.$/, key: 'mapPinLimit' },
  { re: /^Os pronomes podem ter até (\d+) caracteres\.$/, key: 'pronounsTooLong' },
]
