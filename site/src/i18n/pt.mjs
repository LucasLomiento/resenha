// Textos do site em português, a fonte. en.mjs e es.mjs têm as mesmas chaves, e o
// build.mjs para se faltar ou sobrar alguma.
//
// - No index.html, {{chave.de.dentro}} vira o texto daqui e {{MAIÚSCULA}} é valor do
//   build (versão, links). Os textos daqui podem usar os dois.
// - Os textos entram no HTML como estão (pode ter tag), mas sem aspas duplas: no modelo
//   elas fecham atributo. Use “ ” no texto e aspas simples nas tags.
// - O que está em `js` vai pro navegador (main.js), junto com os nomes dos canais.
// - Tom e palavras: os mesmos do app (docs/I18N.md).

export default {
  meta: {
    description:
      'Voz, chat e tela até 1440p a 60 fps pro seu grupo, direto de um PC pro outro. Com rabisco na tela do amigo, mapa junto, Spotify na call e perfil do seu jeito.',
    ogDescription: 'A call da sua turma: voz, chat e tela, direto de um PC pro outro.',
  },

  /** Nome de cada canal, pela id da parte (data-view). O endereço (#) é o nome sem acento. */
  channels: {
    'boas-vindas': 'boas-vindas',
    baixar: 'baixar',
    call: 'call',
    'tela-ao-vivo': 'tela-ao-vivo',
    rabiscos: 'rabiscos',
    mapa: 'mapa',
    perfil: 'perfil',
    spotify: 'spotify',
    conexao: 'conexão',
    novidades: 'novidades',
  },

  common: {
    skip: 'Pular pro conteúdo',
    live: 'AO VIVO',
    bot: 'app',
    you: 'Você',
    now: 'agora',
  },

  rail: {
    label: 'Atalhos',
    home: 'Início',
    server: 'Servidor do Resenha',
    download: 'Baixar',
    code: 'Código no GitHub',
  },

  side: {
    label: 'Canais',
    close: 'Fechar os canais',
    start: 'Comece aqui',
    app: 'Conheça o app',
    project: 'Projeto',
    code: 'código',
  },

  dock: {
    inCall: 'Na call',
    leave: 'Sair da call',
    visitor: 'visitante',
    mute: 'Mutar',
    deafen: 'Ensurdecer',
  },

  head: {
    channels: 'Canais',
    prev: 'Canal anterior',
    next: 'Próximo canal',
    download: 'Baixar',
    language: 'Idioma',
  },

  welcome: {
    topic: 'Comece por aqui: o que é o Resenha e como passear por este site.',
    live: 'Ao vivo',
    version: 'versão {{VERSION}}',
    title: 'A call da sua turma.',
    lede: 'Voz, chat e tela pro seu grupo, direto de um PC pro outro. Transmissão até 1440p a 60 fps com o som do jogo, rabisco na tela do amigo, mapa junto e o Spotify tocando na call.',
    download: 'Baixar o Resenha',
    tour: 'Fazer o tour',
    today: 'Hoje',
    hello:
      'Isso aqui é o Resenha de mentirinha. 👋 Os canais à esquerda são as partes do app: clica em qualquer um, ou usa as setas lá em cima pra ir de um em um.',
    bia: "bora uma call hoje? tô com saudade de <span class='mention'>@galera</span>",
    ask: 'Pode me perguntar alguma coisa aqui embaixo (tela, rabisco, mapa, Spotify, baixar...).',
    placeholder: 'Mensagem em #{{channels.boas-vindas}}',
    message: 'Mensagem',
    send: 'Enviar',
  },

  call: {
    topic: 'Voz direto de um PC pro outro, sem servidor no meio.',
    title: 'Entrou, falou.',
    text: 'A voz vai direto de um PC pro outro. Redução de ruído, detecção de voz, volume de cada um até 200% e o melhor caminho (IPv4 ou IPv6) escolhido sozinho.',
    muted: 'mutado',
  },

  screen: {
    topic: 'Compartilhar a tela: até 1440p a 60 fps, com o som do jogo.',
    title: '1440p, 60 quadros e o som do jogo.',
    text: 'Compartilha o monitor ou uma janela. O som vai em estéreo e a voz da call fica de fora: ninguém se escuta em dobro. Escolhe a qualidade e veja o que muda:',
    quality: 'Qualidade',
    q720: 'Mais leve',
    q1080: 'Full HD',
    q1440: 'Máxima',
  },

  ink: {
    topic: 'Quem assiste desenha por cima, e aparece no monitor de quem compartilha.',
    title: 'Rabisca na tela do amigo.',
    text: 'Arrasta o mouse (ou o dedo) em cima da tela. Laser pra apontar, caneta pra marcar: no app, isso aparece no monitor de quem está transmitindo.',
    tool: 'Ferramenta',
    laser: 'Laser',
    pen: 'Caneta',
    clear: 'Limpar',
    hint: 'Desenha aqui',
  },

  map: {
    topic: 'Um mapa por servidor: arrastou, a galera vai junto.',
    title: 'Todo mundo no mesmo mapa.',
    text: 'Cursores ao vivo, marcadores que ficam salvos no servidor e Street View. Clica no mapa pra marcar um lugar.',
    pin: 'Pizzaria',
    moving: 'Gabi está movendo o mapa',
  },

  profile: {
    topic: 'Banner, foto animada, moldura, efeito e nome com estilo. Pra todo mundo.',
    title: 'O perfil é todo seu.',
    text: 'Tema do cartão, moldura, efeito e nome com fonte e brilho. Pra todo mundo, sem pagar nada. Mexe aqui:',
    pronouns: 'ela/dela',
    bio: 'Mestre do RPG de quinta. Não me chama antes das 10.',
    theme: 'Tema do cartão',
    themes: { ocean: 'Mar', sunset: 'Pôr do sol', forest: 'Floresta', candy: 'Algodão-doce', ember: 'Brasa' },
    frame: 'Moldura',
    frames: { none: 'Nenhuma', neon: 'Neon', aurora: 'Aurora', gold: 'Coroa' },
    name: 'Nome',
    names: { plain: 'Clássico', gradient: 'Degradê', neon: 'Neon' },
  },

  spotify: {
    topic: 'O bot do Spotify toca na call, e cada um ouve no volume que quiser.',
    title: 'A música da call.',
    text: 'Põe o seu Spotify na call: toca pra todo mundo da sala, e qualquer um pula, busca e põe na fila. Clica numa música:',
    prev: 'Anterior',
    next: 'Próxima',
  },

  drop: {
    topic: 'A call aguenta queda de internet, e o app se atualiza sozinho.',
    title: 'Caiu a internet? A call segue.',
    text: 'Voltou em até 30 segundos, ninguém sai da sala e a tela continua passando. Testa:',
    offline: 'Sem conexão. Tentando de novo…',
    back: 'De volta. Ninguém saiu da call.',
    frame: 'quadro',
    button: 'Derrubar a internet',
  },

  updates: {
    topic: '{{COUNT}} versões desde {{FIRST_DATE}}. O app avisa sozinho quando sai a próxima.',
    title: 'Boas-vindas a #{{channels.novidades}}',
    text: 'Tudo que mudou no Resenha, da versão mais nova pra mais antiga.',
    older: 'Versões anteriores',
    newest: 'mais nova',
    /** Etiqueta da versão que ainda não tem a nota traduzida (site/notes). */
    original: 'em português',
  },

  download: {
    topic: 'Versão {{VERSION}}, de {{VERSION_DATE}}. Depois de instalado, ele se atualiza sozinho.',
    title: 'Baixar o Resenha',
    button: 'Baixar',
    copy: 'Copiar o comando',
    arch: { os: 'Arch, CachyOS, Omarchy', kind: 'Pacote .pacman' },
    linux: { os: 'Outras distros Linux', kind: 'AppImage' },
    windows: {
      os: 'Windows 10 e 11',
      kind: 'Instalador',
      alt: "Ou o <a href='{{ZIP_URL}}'>.zip</a>, sem instalar (esse não se atualiza).",
    },
    android: {
      os: 'Android 7 ou mais novo',
      kind: 'App de celular (.apk)',
      alt: 'Fora da Play Store: na primeira vez, o Android pede pra liberar a instalação. O app avisa quando sai versão nova.',
    },
    account: 'Pra entrar, você precisa de uma conta: com convite de alguém do grupo, ou direto, quando o cadastro estiver aberto.',
  },

  foot: {
    made: 'Feito pela resenha, pra resenha. Código aberto.',
    links: 'Links',
    code: 'Código',
    privacy: 'Privacidade',
    terms: 'Termos',
  },

  /** O que o main.js escreve na hora (botões que trocam de estado, o chat, o mapa). */
  js: {
    next: 'Próximo',
    startTour: 'Começar o tour',
    mute: 'Mutar',
    unmute: 'Desmutar',
    deafen: 'Ensurdecer',
    undeafen: 'Voltar a ouvir',
    inCall: 'na call',
    visitor: 'visitante',
    join: 'Entrar na call',
    leave: 'Sair da call',
    noteOut: 'Os outros já estão lá. O anel verde mostra quem está falando.',
    noteIn: 'Você entrou. O microfone e o fone lá embaixo, ao lado do seu nome, funcionam aqui também.',
    noteMuted: 'Você está mudo. Desmuta no microfone lá embaixo, ao lado do seu nome.',
    /** O nome em cima do traço de quem está vendo. */
    inkYou: 'você',
    /** Marcadores que a pessoa põe no mapa, um de cada vez. */
    pins: ['Aqui!', 'Bora?', 'Encontro', 'Lanche', 'Rolê'],
    /** Estilos das músicas do Spotify de mentira, na ordem da lista (main.js). */
    genres: [['sertanejo', 'romântico'], ['pop'], ['rock nacional'], ['bossa nova', 'mpb']],
    play: 'Tocar',
    pause: 'Pausar',
    you: 'Você',
    now: 'agora',
    typing: '<b>Resenha</b> está digitando…',
    copy: 'Copiar o comando',
    copied: 'Copiado',
    cta: { windows: 'Baixar pro Windows', android: 'Baixar pro Android', linux: 'Baixar pro Linux' },
    /** O que o “Resenha” responde no chat, pela primeira que bater; {canal} vira link. */
    answers: [
      [/\b(oi|ol[aá]|e[ai]+e?|salve|bom dia|boa tarde|boa noite|fala)\b/, 'Salve! 👋 Os canais aí do lado mostram o app. Começa por {call}.'],
      [/gr[aá]tis|pag|pre[cç]o|nitro|custa/, 'É de graça e o código é aberto. O perfil caprichado (moldura, nome com brilho) é pra todo mundo: {perfil}.'],
      [/rabisc|desenh|laser|caneta/, 'Quem assiste rabisca na tela de quem transmite, e aparece no monitor dele. Testa em {rabiscos}.'],
      [/tela|transmi|stream|1440|jogo|fps|qualidade/, 'A tela vai até 1440p a 60 fps, com o som do jogo em estéreo e sem a voz da call. Dá uma olhada em {tela-ao-vivo}.'],
      [/mapa|street|lugar/, 'Cada servidor tem um mapa, com o cursor de todo mundo ao vivo. Tá em {mapa}.'],
      [/spotify|m[uú]sica|playlist|bot/, 'O bot do Spotify toca na call e cada um ouve no volume que quiser: {spotify}.'],
      [/perfil|moldura|nome|tema|banner/, 'Tema, moldura, efeito e nome com fonte e brilho, pra todo mundo: {perfil}.'],
      [/ca[iu]|queda|internet|conex|lag|ping|travou/, 'Caiu a internet? Voltou em até 30 s, ninguém sai da call. Simula em {conexao}.'],
      [/baix|instal|windows|linux|arch|android|celular|apk|download|appimage|pacman/, 'Tem pra Arch (.pacman), outras distros (AppImage), Windows e Android: {baixar}.'],
      [/novidade|vers[aã]o|atualiz|changelog|update/, 'Tudo que mudou fica em {novidades}, e o app se atualiza sozinho.'],
      [/call|voz|microfone|fal|ru[ií]do/, 'A voz vai direto de um PC pro outro, com redução de ruído e volume de cada um até 200%: {call}.'],
    ],
    fallback: 'Ainda não sei responder isso 😅 Mas os canais aí do lado mostram tudo. Começa por {call}.',
  },
}
