// Textos que os componentes do kit (ui/kit) põem sozinhos: rótulos padrão e selos.
import type { Badge } from '../../../../../../shared/protocol'

export default {
  colorPicker: {
    label: 'Cor',
    area: 'Saturação e brilho',
    hue: 'Matiz',
    code: 'Código da cor',
  },
  meter: {
    label: 'Nível do microfone',
    threshold: 'Sensibilidade',
  },
  signal: {
    measuring: 'Medindo a conexão…',
    relay: (rtt: number) => `${rtt} ms · pelo servidor (relay)`,
    direct: (rtt: number) => `${rtt} ms · conexão direta`,
  },
  /** Texto do selo ao lado do nome (aparece na dica). */
  badge: {
    founder: 'Fundador do Resenha',
    // O selo do Pioneiro (a primeira pessoa que chegou), com o texto que o dono escreveu pra ele.
    pioneer: 'Melhor amigo do dono do Resenha, o cara mais pika que já conheci. Às vezes puto demais, às vezes puta demais.',
  } satisfies Record<Badge, string>,
}
