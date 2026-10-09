// Textos das configurações da conta e do app (ui/settings) e da busca nelas.
// A busca (lib/settings-search.ts) lê este arquivo também no teste do Node: aqui só
// dados, e os tipos de fora entram com `import type` (somem quando o Node roda).
import type { ShortcutAction } from '../../../../preload/api'
import type { SettingsPage } from '../../ui.svelte'

/** Uma configuração na busca: o nome, o grupo dentro da página e as palavras que levam até ela. */
type SearchEntry = { label: string; section?: string; keywords: string[] }

export default {
  title: 'Configurações',
  nav: {
    account: 'Conta',
    app: 'App',
    admin: 'Administração',
    logout: 'Sair da conta',
  },
  /** Nome de cada página: na navegação, no título dela e no resultado da busca. */
  pages: {
    profile: 'Perfil',
    devices: 'Aparelhos',
    password: 'Senha',
    privacy: 'Privacidade',
    voice: 'Voz e vídeo',
    notifications: 'Notificações',
    shortcuts: 'Atalhos',
    app: 'Aplicativo',
    platform: 'Plataforma',
  } satisfies Record<SettingsPage, string>,
  logout: {
    title: 'Sair da conta?',
    confirm: 'Sair',
  },

  search: {
    placeholder: 'Buscar',
    label: 'Buscar nas configurações',
    results: 'Resultados',
    empty: (query: string) => `Nada com “${query}”.`,
    // Cada configuração: o nome, o grupo e as palavras que levam até ela (sinônimos, o nome
    // no Discord, o jeito que alguém procuraria). As palavras dos outros idiomas também
    // valem, com peso menor: quem digita "language" acha o idioma em qualquer língua.
    entries: {
      // Perfil
      'profile.photo': { label: 'Foto', keywords: ['avatar', 'foto de perfil', 'imagem', 'gif', 'picture', 'pfp'] },
      'profile.name': { label: 'Nome de exibição', keywords: ['nome', 'apelido', 'nick', 'nickname', 'display name'] },
      'profile.pronouns': { label: 'Pronomes', keywords: ['ele/dele', 'ela/dela', 'pronouns'] },
      'profile.username': { label: 'Nome de usuário', keywords: ['usuário', 'username', 'arroba', '@', 'login', 'id'] },
      'profile.bio': { label: 'Sobre mim', keywords: ['bio', 'biografia', 'descrição', 'about me', 'status'] },
      'profile.banner': { label: 'Banner', section: 'Personalizar', keywords: ['capa', 'fundo', 'imagem de fundo', 'header', 'nitro', 'gif'] },
      'profile.color': { label: 'Cor do perfil', section: 'Personalizar', keywords: ['cor', 'cor do banner', 'color', 'nitro'] },
      'profile.theme': { label: 'Tema do cartão', section: 'Personalizar', keywords: ['tema', 'cores', 'gradiente', 'degradê', 'theme', 'nitro'] },
      'profile.decoration': {
        label: 'Moldura do avatar',
        section: 'Personalizar',
        keywords: ['decoração', 'moldura', 'borda', 'enfeite', 'frame', 'decoration', 'nitro'],
      },
      'profile.effect': { label: 'Efeito do perfil', section: 'Personalizar', keywords: ['efeito', 'animação', 'partículas', 'brilho', 'effect', 'nitro'] },
      'profile.nameFont': {
        label: 'Fonte do nome',
        section: 'Personalizar',
        keywords: ['fonte', 'letra', 'tipografia', 'font', 'estilo do nome', 'nitro'],
      },
      'profile.nameEffect': { label: 'Efeito do nome', section: 'Personalizar', keywords: ['neon', 'gradiente', 'nome colorido', 'brilho', 'nitro'] },

      // Aparelhos e senha
      'devices.list': {
        label: 'Aparelhos conectados',
        keywords: ['sessões', 'dispositivos', 'computadores', 'celular', 'onde estou logado', 'login', 'sair', 'devices'],
      },
      'devices.others': {
        label: 'Sair de todos os outros',
        keywords: ['deslogar', 'desconectar', 'encerrar sessões', 'logout', 'segurança', 'invadiram'],
      },
      'password.change': { label: 'Trocar senha', keywords: ['senha', 'mudar senha', 'alterar senha', 'password', 'segurança'] },

      // Privacidade
      'privacy.dms': {
        label: 'Quem pode te mandar mensagem privada',
        keywords: ['dm', 'mensagem direta', 'privado', 'pv', 'spam', 'quem fala comigo', 'direct message'],
      },
      'privacy.blocked': { label: 'Bloqueados', keywords: ['bloquear', 'desbloquear', 'block', 'unblock', 'lista de bloqueio'] },
      'privacy.export': { label: 'Baixar meus dados', section: 'Seus dados', keywords: ['exportar', 'lgpd', 'backup', 'json', 'download', 'dados'] },
      'privacy.delete': {
        label: 'Excluir conta',
        section: 'Seus dados',
        keywords: ['apagar conta', 'deletar', 'remover conta', 'encerrar conta', 'delete account'],
      },
      'privacy.docs': { label: 'Política de privacidade e termos de uso', keywords: ['termos', 'política', 'privacidade', 'lgpd', 'regras'] },

      // Voz e vídeo
      'voice.input': {
        label: 'Microfone',
        section: 'Áudio',
        keywords: ['entrada', 'mic', 'dispositivo de entrada', 'headset', 'input', 'microphone'],
      },
      'voice.output': {
        label: 'Saída de áudio',
        section: 'Áudio',
        keywords: ['alto-falante', 'caixa de som', 'fone', 'headphone', 'som', 'speaker', 'output'],
      },
      'voice.test': {
        label: 'Testar microfone',
        section: 'Áudio',
        keywords: ['teste', 'ouvir minha voz', 'nível', 'volume do microfone', 'medidor', 'mic test'],
      },
      'voice.noise': {
        label: 'Redução de ruído',
        section: 'Áudio',
        keywords: ['ruído', 'barulho', 'chiado', 'supressão', 'rnnoise', 'krisp', 'noise suppression'],
      },
      'voice.gate': {
        label: 'Só transmitir quando eu falar',
        section: 'Áudio',
        keywords: ['detecção de voz', 'ativação por voz', 'sensibilidade', 'limiar', 'gate', 'voice activity', 'silêncio'],
      },
      'voice.camera': { label: 'Câmera', section: 'Câmera', keywords: ['webcam', 'vídeo', 'dispositivo de vídeo', 'camera'] },
      'voice.preview': { label: 'Prévia da câmera', section: 'Câmera', keywords: ['testar câmera', 'ver câmera', 'espelho', 'preview'] },
      'voice.ink': {
        label: 'Quem assiste pode rabiscar na minha tela',
        section: 'Transmissão',
        keywords: ['rabisco', 'rabiscar', 'desenhar', 'anotar', 'caneta', 'laser', 'slack', 'permitir', 'bloquear rabisco', 'tela'],
      },
      'voice.echo': { label: 'Cancelamento de eco', section: 'Avançado', keywords: ['eco', 'echo', 'caixa de som', 'microfonia'] },
      'voice.agc': { label: 'Ganho automático', section: 'Avançado', keywords: ['agc', 'volume automático', 'ganho', 'gain'] },
      'voice.codec': {
        label: 'Codec da transmissão',
        section: 'Avançado',
        keywords: ['vp9', 'vp8', 'h264', 'av1', 'qualidade', 'tela', 'stream', 'cpu', 'compartilhar tela'],
      },
      'voice.stats': { label: 'Estatísticas no player', section: 'Avançado', keywords: ['fps', 'ping', 'resolução', 'bitrate', 'stats', 'lag'] },

      // Notificações
      'notify.sounds': { label: 'Sons do app', section: 'Sons', keywords: ['som', 'barulho', 'efeitos sonoros', 'silenciar', 'mudo', 'sounds'] },
      'notify.volume': { label: 'Volume dos sons', section: 'Sons', keywords: ['volume', 'altura', 'mais baixo', 'mais alto'] },
      'notify.message': { label: 'Som de mensagem nova', section: 'Sons', keywords: ['mensagem', 'notificação sonora', 'ping', 'aviso'] },
      'notify.preview': { label: 'Ouvir cada som', section: 'Sons', keywords: ['testar sons', 'prévia', 'escutar'] },
      'notify.content': {
        label: 'Mostrar o texto da mensagem',
        section: 'Avisos do sistema',
        keywords: ['notificação', 'aviso', 'conteúdo', 'pré-visualização', 'privacidade', 'popup'],
      },

      // Atalhos
      'shortcuts.toggle-mute': { label: 'Atalho de mutar', keywords: ['tecla', 'mute', 'microfone', 'atalho global', 'keybind', 'hotkey'] },
      'shortcuts.toggle-deafen': { label: 'Atalho de ensurdecer', keywords: ['tecla', 'deafen', 'fone', 'keybind', 'hotkey'] },
      'shortcuts.toggle-share': { label: 'Atalho de compartilhar tela', keywords: ['tecla', 'stream', 'transmitir', 'keybind', 'hotkey'] },
      'shortcuts.leave-call': { label: 'Atalho de sair da call', keywords: ['tecla', 'desligar', 'keybind', 'hotkey'] },
      'shortcuts.show-window': { label: 'Atalho de mostrar o Resenha', keywords: ['tecla', 'abrir janela', 'trazer pra frente', 'keybind', 'hotkey'] },
      'shortcuts.all': { label: 'Todos os atalhos', keywords: ['lista de atalhos', 'teclado', 'ctrl', 'keybinds', 'comandos'] },
      'shortcuts.hyprland': { label: 'Atalhos no Hyprland', keywords: ['bind', 'hyprland.conf', 'config', 'segundo plano'] },

      // Aplicativo
      'app.language': {
        label: 'Idioma do Resenha',
        section: 'Idioma',
        keywords: ['idioma', 'língua', 'language', 'lengua', 'english', 'inglês', 'español', 'espanhol', 'português', 'tradução', 'translation'],
      },
      'app.autostart': {
        label: 'Abrir o Resenha ao ligar o computador',
        section: 'Ao ligar o computador',
        keywords: ['iniciar com o sistema', 'inicialização', 'autostart', 'boot', 'login', 'startup'],
      },
      'app.hidden': { label: 'Começar minimizado', section: 'Ao ligar o computador', keywords: ['minimizado', 'segundo plano', 'escondido', 'bandeja'] },
      'app.tray': { label: 'Ícone na bandeja', section: 'Janela', keywords: ['tray', 'bandeja', 'barra de tarefas', 'ícone', 'system tray'] },
      'app.close': { label: 'Fechar só esconde a janela', section: 'Janela', keywords: ['minimizar ao fechar', 'segundo plano', 'fechar', 'x'] },
      'app.zoom': {
        label: 'Tamanho da interface',
        section: 'Janela',
        keywords: ['zoom', 'escala', 'tamanho da letra', 'fonte', 'aumentar', 'diminuir', 'ctrl +'],
      },
      'app.update': {
        label: 'Atualizações',
        section: 'Atualizações',
        keywords: ['atualizar', 'versão', 'update', 'nova versão', 'baixar atualização', 'novidades'],
      },

      // Plataforma
      'platform.signup': { label: 'Cadastro', keywords: ['convite', 'cadastro aberto', 'registro', 'criar conta', 'turnstile'] },
      'platform.accounts': { label: 'Contas', keywords: ['usuários', 'banir', 'moderação', 'pessoas'] },
      'platform.storage': { label: 'Espaço usado', keywords: ['armazenamento', 'anexos', 'disco', 'arquivos', 'storage'] },
      'platform.invites': { label: 'Convites ativos', keywords: ['convites', 'quantos convites', 'links de convite'] },
      'platform.media': { label: 'Mídia pelo Cloudflare', keywords: ['sfu', 'turn', 'cota', 'gb', 'banda', 'transmissão', 'tela', 'relay'] },
    } satisfies Record<string, SearchEntry>,
  },

  profile: {
    nameEmpty: 'O nome não pode ficar vazio.',
    photo: {
      label: 'Foto',
      change: 'Trocar foto',
      hint: 'GIF animado também vale (até 1,5 MB).',
    },
    name: {
      label: 'Nome de exibição',
      hint: 'Como aparece nas conversas.',
    },
    pronouns: {
      label: 'Pronomes',
      placeholder: 'ele/dele, ela/dela…',
    },
    username: {
      label: 'Nome de usuário',
      hint: 'Único. É como te acham pra adicionar como amigo.',
    },
    bio: 'Sobre mim',
    customize: 'Personalizar',
    banner: {
      label: 'Banner',
      change: 'Trocar banner',
      hint: 'Sem banner, o topo fica com as cores do tema ou do perfil.',
    },
    color: {
      label: 'Cor do perfil',
      /** As amostras de cor (a automática é o degradê do avatar). */
      swatches: {
        violet: 'Violeta',
        coral: 'Coral',
        ocean: 'Oceano',
        mint: 'Menta',
        sun: 'Sol',
        orchid: 'Orquídea',
        lime: 'Lima',
        auto: 'Automática',
        current: 'Cor atual',
      },
    },
    theme: {
      label: 'Tema do cartão',
      none: 'Sem tema',
      main: 'Principal',
      accent: 'Destaque',
      mainColor: 'Cor principal',
      accentColor: 'Cor de destaque',
      /** "Principal: #7c6cff", no botão de cada cor. */
      chip: (label: string, code: string) => `${label}: ${code}`,
    },
    decoration: {
      label: 'Moldura do avatar',
      none: 'Nenhuma',
    },
    effect: {
      label: 'Efeito do perfil',
      none: 'Nenhum',
    },
    nameFont: {
      label: 'Fonte do nome',
      none: 'Padrão',
    },
    nameEffect: {
      label: 'Efeito do nome',
      none: 'Nenhum',
    },
    preview: 'Prévia',
    previewLabel: 'Prévia do perfil',
    since: 'No Resenha desde',
    unsaved: {
      label: 'Alterações não salvas',
      text: 'Você tem alterações não salvas.',
    },
  },

  devices: {
    description: 'Onde sua conta está conectada. Aparelho parado por 30 dias sai sozinho.',
    tor: 'Rede Tor',
    // O servidor grava o nome do aparelho em português; traduzido na hora de mostrar.
    appOn: (os: string) => `App no ${os}`,
    resenhaApp: 'App Resenha',
    unknownDevice: 'Aparelho',
    now: 'agora',
    lastHour: 'na última hora',
    current: 'Este aparelho',
    signOut: 'Sair',
    others: {
      label: 'Sair de todos os outros',
      some: 'Só este aparelho continua conectado.',
      none: 'Nenhum outro aparelho conectado.',
      button: 'Sair dos outros',
      title: 'Sair dos outros aparelhos?',
      description: 'Só este continua conectado.',
      confirm: 'Sair',
      done: (count: number) => `${count} ${count === 1 ? 'aparelho saiu' : 'aparelhos saíram'}.`,
    },
    loadError: 'Não deu pra carregar os aparelhos.',
  },

  password: {
    description: 'Trocar a senha desconecta os outros aparelhos.',
    current: 'Senha atual',
    next: 'Nova senha',
    repeat: 'Repita a nova senha',
    submit: 'Trocar senha',
    strength: {
      label: 'Força da senha',
      atLeast: (min: number) => `Pelo menos ${min} caracteres`,
      missing: (count: number) => (count === 1 ? 'Falta 1 caractere' : `Faltam ${count} caracteres`),
      guessable: 'Fácil de adivinhar',
      fair: 'Razoável',
      good: 'Boa',
      strong: 'Forte',
    },
    mismatch: 'As senhas não são iguais.',
    changed: 'Senha trocada. Os outros aparelhos saíram.',
  },

  privacy: {
    dms: {
      title: 'Quem pode te mandar mensagem privada',
      description: 'Seus amigos sempre podem.',
      everyone: 'Qualquer pessoa',
      servers: 'Quem está nos meus servidores',
      friends: 'Só amigos',
    },
    blocked: {
      title: 'Bloqueados',
      description: 'Não podem te mandar mensagem privada nem pedido de amizade.',
      unblock: 'Desbloquear',
      none: 'Você não bloqueou ninguém.',
    },
    data: {
      section: 'Seus dados',
      export: 'Baixar meus dados',
      exportDescription: 'Perfil, aparelhos, servidores, amigos e bloqueios, num arquivo JSON.',
      download: 'Baixar',
      /** Nome do arquivo baixado. */
      file: 'resenha-meus-dados.json',
    },
    remove: {
      label: 'Excluir conta',
      description: 'Sai de todos os servidores. Suas mensagens ficam como “Usuário excluído”.',
      title: 'Excluir conta?',
      warning: 'Não dá pra desfazer. Você sai de todos os servidores e suas mensagens ficam como “Usuário excluído”.',
      password: 'Sua senha',
      /** Os nomes chegam separados por vírgula. */
      ownsServers: (names: string) => `Antes, transfira ou exclua seus servidores: ${names}.`,
    },
    docs: {
      privacy: 'Política de privacidade',
      terms: 'Termos de uso',
    },
  },

  voice: {
    systemDefault: 'Padrão do sistema',
    noMic: (message: string) => `Sem acesso ao microfone: ${message}`,
    noCamera: (message: string) => `Não deu pra abrir a câmera: ${message}`,
    audio: {
      section: 'Áudio',
      input: 'Microfone',
      output: 'Saída',
      outputLabel: 'Saída de áudio',
      /** Nome de um alto-falante que o sistema não deu nome. */
      speaker: 'Alto-falante',
      test: 'Testar microfone',
      stopTest: 'Parar teste',
      testing: 'Você está se ouvindo. Use fone pra não dar eco.',
      noise: 'Redução de ruído',
      noiseDescription: 'Já filtra o ruído no sistema? Deixe desligada.',
      noiseStrong: 'Forte',
      noiseLight: 'Leve',
      noiseOff: 'Desligada',
      gate: 'Só transmitir quando eu falar',
      gateDescription: 'O resto vira silêncio.',
      detection: 'Detecção',
      detectionAuto: 'Reconhece a sua voz sozinho.',
      detectionManual: 'Arraste a marca branca na barra do teste.',
      auto: 'Automática',
      manual: 'Manual',
    },
    camera: {
      section: 'Câmera',
      device: 'Dispositivo',
      label: 'Câmera',
      preview: 'Prévia',
      open: 'Ver prévia',
      close: 'Fechar prévia',
    },
    stream: {
      section: 'Transmissão',
      ink: 'Quem assiste pode rabiscar na minha tela',
      inkDescription: 'Desenham por cima da transmissão e você vê no seu monitor. Só com a tela inteira.',
    },
    advanced: {
      section: 'Avançado',
      echo: 'Cancelamento de eco',
      echoDescription: 'Útil pra quem usa caixa de som.',
      agc: 'Ganho automático',
      agcDescription: 'Ajusta o volume da sua voz sozinho.',
      codec: 'Codec da transmissão',
      codecDescription: 'VP8 e H264 pesam menos no computador.',
      stats: 'Estatísticas no player',
      statsDescription: 'Resolução, fps e ping da transmissão.',
    },
  },

  notifications: {
    sounds: {
      section: 'Sons',
      app: 'Sons do app',
      appDescription: 'Entrar e sair da call, mutar e transmissões.',
      volume: 'Volume',
      volumeLabel: 'Volume dos sons',
      listen: 'Ouvir',
      message: 'Mensagem nova',
      each: 'Ouvir cada som',
    },
    system: {
      section: 'Avisos do sistema',
      content: 'Mostrar o texto da mensagem',
      contentDescription: 'Desligado, o aviso só diz que chegou mensagem.',
    },
  },

  shortcuts: {
    description: 'Funcionam mesmo com o Resenha minimizado.',
    all: 'Todos os atalhos',
    /** Nomes curtos: o atalho alterna (aperta de novo, desfaz). */
    actions: {
      'toggle-mute': 'Mutar',
      'toggle-deafen': 'Ensurdecer',
      'toggle-share': 'Compartilhar tela',
      'leave-call': 'Sair da call',
      'show-window': 'Mostrar o Resenha',
    } satisfies Record<ShortcutAction, string>,
    change: (action: string) => `Mudar o atalho de ${action}`,
    recording: 'Aperte as teclas…',
    none: 'Nenhum',
    remove: 'Remover atalho',
    failed: 'O sistema não deixou usar esse atalho fora do app. Com o Resenha aberto, ele funciona.',
    hyprland: {
      section: 'No Hyprland',
      // {command} e {ação} viram código: o comando inteiro e o nome de cada ação.
      text: 'O Resenha cria esses atalhos no Hyprland sozinho enquanto está aberto (eles aparecem na lista de atalhos do sistema). Se a tecla já tiver uso na sua config, ele não mexe e avisa aqui. Pra ligar de outro jeito, {command} também funciona, assim como {toggle-deafen}, {toggle-share}, {leave-call} e {show-window}.',
    },
  },

  platform: {
    ownerDescription: 'Vale pro Resenha inteiro, não só pros seus servidores.',
    viewerDescription: 'Os números do Resenha inteiro. Só pra ver: quem mexe aqui é o dono.',
    stats: {
      accounts: 'Contas',
      servers: 'Servidores',
      invites: 'Convites ativos',
      storage: 'Espaço usado',
      media: 'Mídia pelo Cloudflare neste mês',
      /** "de 4 GB", menor, depois do quanto foi usado. */
      of: (limit: string) => `de ${limit}`,
    },
    storageFull: 'Cheio: anexos novos não sobem.',
    storageWarn: (percent: number) => `Quase cheio (${percent}%).`,
    mediaFull: 'Acabou a cota do mês: tela e calls ficam só diretas até o mês virar.',
    mediaNote: 'Tela com 2 ou mais assistindo e conexões que não fecham direto. O grátis é 1.000 GB; o Resenha para antes.',
    signup: {
      title: 'Cadastro',
      invite: 'Só com convite',
      inviteDescription: 'Quem chega precisa do convite de algum servidor.',
      open: 'Aberto',
      openDescription: 'Qualquer pessoa cria conta, com verificação anti-robô.',
    },
    loadError: 'Não deu pra carregar o painel.',
    accounts: {
      title: 'Contas',
      placeholder: 'Nome ou usuário',
      search: 'Buscar contas',
      searchError: 'Não deu pra buscar.',
      since: (username: string, date: string) => `${username} · desde ${date}`,
      pioneer: 'Melhor amigo',
      makePioneer: 'Tornar melhor amigo',
      banned: 'Suspensa',
      unban: 'Reativar',
      ban: 'Suspender',
      noMatch: 'Ninguém com esse nome.',
      none: 'Nenhuma conta ainda.',
    },
    pioneer: {
      title: (name: string) => `Dar o selo de melhor amigo pra ${name}?`,
      description: 'O selo de melhor amigo do dono, a moldura e o nome exclusivos saem de quem tem agora e passam pra essa conta.',
      confirm: 'Dar o selo',
    },
    ban: {
      title: (name: string) => `Suspender ${name}?`,
      description: 'A conta sai de todos os aparelhos e não entra mais até você reativar.',
      confirm: 'Suspender',
    },
  },

  app: {
    title: 'Aplicativo',
    language: {
      section: 'Idioma',
      label: 'Idioma do Resenha',
      auto: (name: string) => `Automático (${name})`,
      description: 'O automático segue o idioma do sistema.',
    },
    startup: {
      section: 'Ao ligar o computador',
      open: 'Abrir o Resenha',
      hidden: 'Começar minimizado',
    },
    window: {
      section: 'Janela',
      tray: 'Ícone na bandeja',
      trayDescription: 'Mutar, ensurdecer e sair da call pelo ícone.',
      close: 'Fechar só esconde a janela',
      closeDescription: 'A call continua.',
      zoom: 'Tamanho da interface',
      zoomOut: 'Diminuir',
      zoomIn: 'Aumentar',
      zoomReset: 'Padrão',
    },
    updates: {
      section: 'Atualizações',
      none: 'Você está na versão mais nova.',
      checking: 'Procurando…',
      available: (version: string) => `A versão ${version} saiu.`,
      downloading: (version: string, percent: number) => `Baixando a ${version} (${percent}%).`,
      ready: (version: string) => `A ${version} está pronta pra instalar.`,
      installing: 'Instalando…',
      unsupported: 'Este jeito de instalar não se atualiza sozinho.',
      error: (message: string) => `Não deu pra atualizar: ${message}`,
      download: 'Baixar',
      install: 'Reiniciar e atualizar',
      check: 'Procurar atualização',
    },
  },
}
