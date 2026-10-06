// Emojis do seletor (reações e campo de texto), com nomes em português pra
// busca. Só Unicode: aparece igual em qualquer computador.

export interface EmojiEntry {
  e: string
  /** Palavras pra busca (minúsculas, sem acento). */
  k: string
}

export interface EmojiCategory {
  id: string
  label: string
  icon: string
  list: EmojiEntry[]
}

const parse = (text: string): EmojiEntry[] =>
  text
    .trim()
    .split('\n')
    .map((line) => {
      const [e, ...k] = line.trim().split(' ')
      return { e, k: k.join(' ') }
    })

export const CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Carinhas',
    icon: '😀',
    list: parse(`
😀 sorriso feliz
😃 sorriso feliz olhos
😄 sorriso alegre
😁 sorrisao dentes
😆 risada
😅 suor nervoso risada
🤣 rolando de rir
😂 chorando de rir kkk
🙂 sorriso leve
🙃 de cabeca pra baixo ironia
😉 piscada
😊 feliz corado
😇 anjo inocente
🥰 apaixonado coracoes
😍 olhos de coracao amei
🤩 deslumbrado estrelas
😘 beijo
😗 beijinho
😚 beijo olhos fechados
😋 gostoso delicia
😛 lingua
😜 lingua piscando
🤪 doido maluco
😝 lingua olhos fechados
🤑 dinheiro
🤗 abraco
🤭 ops mao na boca
🤫 silencio segredo
🤔 pensando hmm
🫡 continencia sentido
🤐 boca fechada ziper
🤨 desconfiado sobrancelha
😐 neutro
😑 sem expressao
😶 sem boca
🫥 invisivel
😏 malicioso sorrisinho
😒 entediado desdem
🙄 revirando olhos
😬 sem graca constrangido
😮‍💨 alivio suspiro
🤥 mentiroso pinoquio
😌 aliviado
😔 pensativo triste
😪 sono
🤤 babando
😴 dormindo zzz
😷 mascara doente
🤒 febre doente
🤕 machucado
🤢 enjoado nojo
🤮 vomitando
🥵 calor quente
🥶 frio congelando
🥴 tonto bebado
😵 tonto
😵‍💫 confuso girando
🤯 explodindo cabeca mente
🤠 cowboy
🥳 festa comemorando
🥸 disfarce
😎 oculos escuros descolado
🤓 nerd
🧐 monoculo analisando
😕 confuso
🫤 desconfortavel
😟 preocupado
🙁 triste leve
😮 surpreso boca aberta
😯 espantado
😲 chocado
😳 vergonha corado
🥺 pidao suplicando
🥹 emocionado segurando choro
😦 assustado
😧 angustiado
😨 medo
😰 ansioso suor
😥 triste aliviado
😢 chorando lagrima
😭 chorando muito
😱 grito medo
😖 confuso frustrado
😣 perseverante
😞 desapontado
😓 suor frio
😩 cansado
😫 exausto
🥱 bocejo
😤 bufando orgulho
😡 bravo furioso
😠 raiva
🤬 xingando palavrao
😈 diabinho
👿 diabo bravo
💀 caveira morri
☠️ caveira ossos
💩 coco
🤡 palhaco
👹 ogro
👻 fantasma
👽 alien
🤖 robo
😺 gato sorrindo
😹 gato rindo
😻 gato apaixonado
🙈 macaco nao vejo
🙉 macaco nao ouco
🙊 macaco nao falo
`),
  },
  {
    id: 'people',
    label: 'Gestos',
    icon: '👋',
    list: parse(`
👋 tchau oi acenando
🤚 mao levantada
✋ mao pare
🖖 vulcano
👌 ok perfeito
🤌 italiano
🤏 pouquinho
✌️ paz vitoria
🤞 dedos cruzados sorte
🫰 coracao dedos
🤟 te amo
🤘 rock
🤙 me liga
👈 esquerda
👉 direita
👆 cima
👇 baixo
☝️ indicador um
👍 joinha positivo curti
👎 negativo nao curti
✊ punho
👊 soco
🤛 toca aqui esquerda
🤜 toca aqui direita
👏 palmas aplausos
🙌 celebrando maos
🫶 coracao maos
👐 maos abertas
🤲 palmas juntas
🤝 aperto de mao acordo
🙏 por favor obrigado reza
✍️ escrevendo
💅 unha esmalte
💪 forca musculo
🧠 cerebro
👀 olhos olhando
👁️ olho
👄 boca
🫦 mordendo labio
👶 bebe
🧒 crianca
👦 menino
👧 menina
🧑 pessoa
👨 homem
👩 mulher
🧓 idoso
👴 vovo
👵 vovo vó
🙋 levantando mao
🙅 nao negando
🙆 ok braços
🤷 sei la ombros
🤦 facepalm vergonha
🙇 reverencia desculpa
💁 informacao
🧏 surdo
🚶 andando
🏃 correndo
💃 dancando
🕺 dancando homem
👯 festa dupla
🧘 meditando
🛌 dormindo cama
👨‍💻 programador computador
👩‍💻 programadora computador
🧑‍🎤 cantor rock
🥷 ninja
🦸 heroi
🦹 vilao
🧙 mago
🧛 vampiro
🧟 zumbi
`),
  },
  {
    id: 'nature',
    label: 'Bichos e natureza',
    icon: '🐶',
    list: parse(`
🐶 cachorro
🐱 gato
🐭 rato
🐹 hamster
🐰 coelho
🦊 raposa
🐻 urso
🐼 panda
🐨 coala
🐯 tigre
🦁 leao
🐮 vaca
🐷 porco
🐸 sapo
🐵 macaco
🐔 galinha
🐧 pinguim
🐦 passaro
🐤 pintinho
🦆 pato
🦅 aguia
🦉 coruja
🦇 morcego
🐺 lobo
🐗 javali
🐴 cavalo
🦄 unicornio
🐝 abelha
🐛 lagarta
🦋 borboleta
🐌 lesma
🐞 joaninha
🐜 formiga
🕷️ aranha
🐢 tartaruga
🐍 cobra
🦎 lagarto
🦖 dinossauro
🐙 polvo
🦑 lula
🦀 caranguejo
🐠 peixe
🐬 golfinho
🐳 baleia
🦈 tubarao
🐊 jacare
🐘 elefante
🦒 girafa
🐕 cachorro
🐈 gato
🐓 galo
🦜 papagaio
🌵 cacto
🎄 arvore natal
🌲 pinheiro
🌳 arvore
🌴 palmeira coqueiro
🌱 broto planta
🍀 trevo sorte
🍁 folha outono
🍄 cogumelo
🌷 tulipa flor
🌹 rosa flor
🌻 girassol
🌸 flor cerejeira
💐 buque flores
🌎 mundo terra
🌙 lua
⭐ estrela
🌟 estrela brilhando
✨ brilho
⚡ raio
🔥 fogo foda
🌈 arco iris
☀️ sol
⛅ nublado
🌧️ chuva
⛈️ tempestade
❄️ neve floco
☃️ boneco neve
🌊 onda mar
💧 gota
`),
  },
  {
    id: 'food',
    label: 'Comida',
    icon: '🍔',
    list: parse(`
🍎 maca
🍊 laranja
🍋 limao
🍌 banana
🍉 melancia
🍇 uva
🍓 morango
🍒 cereja
🍑 pessego
🥭 manga
🍍 abacaxi
🥥 coco
🥝 kiwi
🍅 tomate
🥑 abacate
🌶️ pimenta
🌽 milho
🥕 cenoura
🥔 batata
🍞 pao
🧀 queijo
🥚 ovo
🍳 ovo frito
🥓 bacon
🥩 carne
🍗 frango coxa
🌭 cachorro quente
🍔 hamburguer
🍟 batata frita
🍕 pizza
🥪 sanduiche
🌮 taco
🌯 burrito
🥗 salada
🍝 macarrao
🍜 lamen
🍣 sushi
🍤 camarao
🍙 bolinho arroz
🍚 arroz
🍰 bolo fatia
🎂 bolo aniversario
🧁 cupcake
🍩 rosquinha donut
🍪 biscoito cookie
🍫 chocolate
🍬 bala doce
🍭 pirulito
🍿 pipoca
🍦 sorvete casquinha
☕ cafe
🍵 cha
🧉 chimarrao mate
🥤 refrigerante copo
🧃 suco caixinha
🍺 cerveja
🍻 brinde cervejas
🥂 brinde taças
🍷 vinho
🥃 whisky dose
🍸 drink
🍹 drink tropical
🧊 gelo
`),
  },
  {
    id: 'activity',
    label: 'Atividades',
    icon: '⚽',
    list: parse(`
⚽ futebol bola
🏀 basquete
🏈 futebol americano
⚾ beisebol
🎾 tenis
🏐 volei
🏉 rugby
🎱 sinuca bola 8
🏓 ping pong
🏸 badminton
🥊 boxe luva
🥋 artes marciais
⛳ golfe
🏆 trofeu campeao
🥇 ouro primeiro
🥈 prata segundo
🥉 bronze terceiro
🏅 medalha
🎯 alvo na mosca
🎮 videogame controle
🕹️ joystick fliperama
🎲 dado
♟️ xadrez
🧩 quebra cabeca
🎨 arte pintura
🎬 cinema filme
🎤 microfone karaoke
🎧 fone de ouvido musica
🎸 guitarra
🎹 teclado piano
🥁 bateria
🎷 saxofone
🎺 trompete
🎻 violino
🎉 festa confete
🎊 confete
🎈 balao
🎁 presente
🎃 abobora halloween
🎆 fogos
🎇 estrelinha
🧨 bombinha
`),
  },
  {
    id: 'objects',
    label: 'Objetos',
    icon: '💡',
    list: parse(`
💻 notebook computador
🖥️ computador monitor
⌨️ teclado
🖱️ mouse
📱 celular
☎️ telefone
📞 telefone ligacao
📷 camera foto
🎥 camera video filmando
📺 tv televisao
🔊 som alto
🔇 mudo
🎙️ microfone estudio
💡 ideia lampada
🔦 lanterna
🕯️ vela
💰 dinheiro saco
💸 dinheiro voando gastando
💳 cartao credito
💎 diamante
🔧 chave ferramenta
🔨 martelo
⚙️ engrenagem configuracao
🔗 link corrente
🔒 cadeado fechado
🔓 cadeado aberto
🔑 chave
🛡️ escudo
⚔️ espadas
🗡️ adaga
💣 bomba
🧲 ima
📦 caixa pacote
📫 correio
✉️ envelope email
📝 anotacao memo
📌 alfinete fixar
📎 clipe anexo
✂️ tesoura
📅 calendario
⏰ despertador
⏳ ampulheta esperando
⌛ tempo acabou
🚀 foguete lancamento
✈️ aviao
🚗 carro
🏠 casa
🏖️ praia
🗿 moai serio
`),
  },
  {
    id: 'symbols',
    label: 'Símbolos',
    icon: '❤️',
    list: parse(`
❤️ coracao vermelho amor
🧡 coracao laranja
💛 coracao amarelo
💚 coracao verde
💙 coracao azul
💜 coracao roxo
🖤 coracao preto
🤍 coracao branco
🤎 coracao marrom
💔 coracao partido
❤️‍🔥 coracao pegando fogo
💕 dois coracoes
💞 coracoes girando
💓 coracao batendo
💗 coracao crescendo
💖 coracao brilhando
💘 coracao flecha
💝 coracao presente
💯 cem perfeito
💢 raiva
💥 explosao
💫 tonto estrela
💦 suor gotas
💨 vento correndo
💬 balao fala
💭 pensamento
🗯️ balao bravo
💤 sono zzz
✅ certo check feito
☑️ caixa marcada
✔️ check
❌ errado x
❎ x quadrado
⭕ circulo
🚫 proibido
⛔ entrada proibida
⚠️ aviso cuidado
❓ pergunta
❔ pergunta branca
❗ exclamacao
‼️ exclamacao dupla
⁉️ exclamacao pergunta
➕ mais
➖ menos
➗ dividir
✖️ vezes
♾️ infinito
🔴 bola vermelha
🟠 bola laranja
🟡 bola amarela
🟢 bola verde
🔵 bola azul
🟣 bola roxa
⚫ bola preta
⚪ bola branca
🆗 ok
🆕 novo
🆒 legal cool
🆙 up
🔝 top
🔜 em breve soon
1️⃣ um
2️⃣ dois
3️⃣ tres
4️⃣ quatro
5️⃣ cinco
🔟 dez
`),
  },
  {
    id: 'flags',
    label: 'Bandeiras',
    icon: '🏳️',
    list: parse(`
🇧🇷 brasil
🇵🇹 portugal
🇦🇷 argentina
🇺🇸 estados unidos eua
🇯🇵 japao
🇰🇷 coreia do sul
🇩🇪 alemanha
🇫🇷 franca
🇮🇹 italia
🇪🇸 espanha
🇬🇧 reino unido inglaterra
🇨🇦 canada
🇲🇽 mexico
🇺🇾 uruguai
🇨🇱 chile
🇨🇴 colombia
🏳️‍🌈 arco iris lgbt orgulho
🏴‍☠️ pirata
🏁 chegada corrida
🚩 bandeira vermelha alerta
`),
  },
]

export const ALL_EMOJI: EmojiEntry[] = CATEGORIES.flatMap((c) => c.list)

/** Tira acento e deixa minúsculo, pra busca. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function searchEmoji(query: string, limit = 48): EmojiEntry[] {
  const q = fold(query.trim())
  if (!q) return []
  const starts = ALL_EMOJI.filter((x) => x.k.split(' ').some((w) => w.startsWith(q)))
  const contains = ALL_EMOJI.filter((x) => !starts.includes(x) && x.k.includes(q))
  return [...starts, ...contains].slice(0, limit)
}

const RECENT_KEY = 'resenha.recentEmoji'
const DEFAULT_RECENT = ['👍', '😂', '❤️', '🔥', '😭', '👀', '🎉', '🙏']

export function recentEmoji(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    return saved.length ? saved : DEFAULT_RECENT
  } catch {
    return DEFAULT_RECENT
  }
}

export function rememberEmoji(emoji: string) {
  const list = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 24)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // sem armazenamento
  }
}
