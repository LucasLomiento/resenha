// Busca nas configurações: cada configuração tem um lugar (página + âncora
// `data-setting` na linha) e palavras que levam até ela, além do próprio nome:
// sinônimos, o nome no Discord, em inglês, o jeito que alguém procuraria.
// Configuração nova: ponha aqui e marque a linha com `setting="<id>"` (o e2e
// confere que toda âncora daqui existe na página).

import type { SettingsPage } from './ui.svelte'

export interface SettingEntry {
  /** Âncora na página (`setting` no Row/Section). */
  id: string
  page: SettingsPage
  label: string
  /** Grupo dentro da página, pra mostrar no resultado. */
  section?: string
  keywords: string[]
  /** Só pra quem é dono da plataforma. */
  staff?: boolean
  /** Só no app de computador (as opções que dependem do sistema). */
  desktop?: boolean
  /** Só no Hyprland. */
  hyprland?: boolean
}

export const PAGE_LABEL: Record<SettingsPage, string> = {
  profile: 'Perfil',
  devices: 'Aparelhos',
  password: 'Senha',
  privacy: 'Privacidade',
  voice: 'Voz e vídeo',
  notifications: 'Notificações',
  shortcuts: 'Atalhos',
  app: 'Aplicativo',
  platform: 'Plataforma',
}

export const SETTINGS: SettingEntry[] = [
  // Perfil
  { id: 'profile.photo', page: 'profile', label: 'Foto', keywords: ['avatar', 'foto de perfil', 'imagem', 'gif', 'picture', 'pfp'] },
  { id: 'profile.name', page: 'profile', label: 'Nome de exibição', keywords: ['nome', 'apelido', 'nick', 'nickname', 'display name'] },
  { id: 'profile.pronouns', page: 'profile', label: 'Pronomes', keywords: ['ele/dele', 'ela/dela', 'pronouns'] },
  { id: 'profile.username', page: 'profile', label: 'Nome de usuário', keywords: ['usuário', 'username', 'arroba', '@', 'login', 'id'] },
  { id: 'profile.bio', page: 'profile', label: 'Sobre mim', keywords: ['bio', 'biografia', 'descrição', 'about me', 'status'] },
  { id: 'profile.banner', page: 'profile', section: 'Personalizar', label: 'Banner', keywords: ['capa', 'fundo', 'imagem de fundo', 'header', 'nitro', 'gif'] },
  { id: 'profile.color', page: 'profile', section: 'Personalizar', label: 'Cor do perfil', keywords: ['cor', 'cor do banner', 'color', 'nitro'] },
  { id: 'profile.theme', page: 'profile', section: 'Personalizar', label: 'Tema do cartão', keywords: ['tema', 'cores', 'gradiente', 'degradê', 'theme', 'nitro'] },
  { id: 'profile.decoration', page: 'profile', section: 'Personalizar', label: 'Moldura do avatar', keywords: ['decoração', 'moldura', 'borda', 'enfeite', 'frame', 'decoration', 'nitro'] },
  { id: 'profile.effect', page: 'profile', section: 'Personalizar', label: 'Efeito do perfil', keywords: ['efeito', 'animação', 'partículas', 'brilho', 'effect', 'nitro'] },
  { id: 'profile.nameFont', page: 'profile', section: 'Personalizar', label: 'Fonte do nome', keywords: ['fonte', 'letra', 'tipografia', 'font', 'estilo do nome', 'nitro'] },
  { id: 'profile.nameEffect', page: 'profile', section: 'Personalizar', label: 'Efeito do nome', keywords: ['neon', 'gradiente', 'nome colorido', 'brilho', 'nitro'] },

  // Aparelhos e senha
  { id: 'devices.list', page: 'devices', label: 'Aparelhos conectados', keywords: ['sessões', 'dispositivos', 'computadores', 'celular', 'onde estou logado', 'login', 'sair', 'devices'] },
  { id: 'devices.others', page: 'devices', label: 'Sair de todos os outros', keywords: ['deslogar', 'desconectar', 'encerrar sessões', 'logout', 'segurança', 'invadiram'] },
  { id: 'password.change', page: 'password', label: 'Trocar senha', keywords: ['senha', 'mudar senha', 'alterar senha', 'password', 'segurança'] },

  // Privacidade
  { id: 'privacy.dms', page: 'privacy', label: 'Quem pode te mandar mensagem privada', keywords: ['dm', 'mensagem direta', 'privado', 'pv', 'spam', 'quem fala comigo', 'direct message'] },
  { id: 'privacy.blocked', page: 'privacy', label: 'Bloqueados', keywords: ['bloquear', 'desbloquear', 'block', 'unblock', 'lista de bloqueio'] },
  { id: 'privacy.export', page: 'privacy', section: 'Seus dados', label: 'Baixar meus dados', keywords: ['exportar', 'lgpd', 'backup', 'json', 'download', 'dados'] },
  { id: 'privacy.delete', page: 'privacy', section: 'Seus dados', label: 'Excluir conta', keywords: ['apagar conta', 'deletar', 'remover conta', 'encerrar conta', 'delete account'] },
  { id: 'privacy.docs', page: 'privacy', label: 'Política de privacidade e termos de uso', keywords: ['termos', 'política', 'privacidade', 'lgpd', 'regras'] },

  // Voz e vídeo
  { id: 'voice.input', page: 'voice', section: 'Áudio', label: 'Microfone', keywords: ['entrada', 'mic', 'dispositivo de entrada', 'headset', 'input', 'microphone'] },
  { id: 'voice.output', page: 'voice', section: 'Áudio', label: 'Saída de áudio', keywords: ['alto-falante', 'caixa de som', 'fone', 'headphone', 'som', 'speaker', 'output'] },
  { id: 'voice.test', page: 'voice', section: 'Áudio', label: 'Testar microfone', keywords: ['teste', 'ouvir minha voz', 'nível', 'volume do microfone', 'medidor', 'mic test'] },
  { id: 'voice.noise', page: 'voice', section: 'Áudio', label: 'Redução de ruído', keywords: ['ruído', 'barulho', 'chiado', 'supressão', 'rnnoise', 'krisp', 'noise suppression'] },
  { id: 'voice.gate', page: 'voice', section: 'Áudio', label: 'Só transmitir quando eu falar', keywords: ['detecção de voz', 'ativação por voz', 'sensibilidade', 'limiar', 'gate', 'voice activity', 'silêncio'] },
  { id: 'voice.camera', page: 'voice', section: 'Câmera', label: 'Câmera', keywords: ['webcam', 'vídeo', 'dispositivo de vídeo', 'camera'] },
  { id: 'voice.preview', page: 'voice', section: 'Câmera', label: 'Prévia da câmera', keywords: ['testar câmera', 'ver câmera', 'espelho', 'preview'] },
  { id: 'voice.echo', page: 'voice', section: 'Avançado', label: 'Cancelamento de eco', keywords: ['eco', 'echo', 'caixa de som', 'microfonia'] },
  { id: 'voice.agc', page: 'voice', section: 'Avançado', label: 'Ganho automático', keywords: ['agc', 'volume automático', 'ganho', 'gain'] },
  { id: 'voice.codec', page: 'voice', section: 'Avançado', label: 'Codec da transmissão', keywords: ['vp9', 'vp8', 'h264', 'av1', 'qualidade', 'tela', 'stream', 'cpu', 'compartilhar tela'] },
  { id: 'voice.stats', page: 'voice', section: 'Avançado', label: 'Estatísticas no player', keywords: ['fps', 'ping', 'resolução', 'bitrate', 'stats', 'lag'] },

  // Notificações
  { id: 'notify.sounds', page: 'notifications', section: 'Sons', label: 'Sons do app', keywords: ['som', 'barulho', 'efeitos sonoros', 'silenciar', 'mudo', 'sounds'] },
  { id: 'notify.volume', page: 'notifications', section: 'Sons', label: 'Volume dos sons', keywords: ['volume', 'altura', 'mais baixo', 'mais alto'] },
  { id: 'notify.message', page: 'notifications', section: 'Sons', label: 'Som de mensagem nova', keywords: ['mensagem', 'notificação sonora', 'ping', 'aviso'] },
  { id: 'notify.preview', page: 'notifications', section: 'Sons', label: 'Ouvir cada som', keywords: ['testar sons', 'prévia', 'escutar'] },
  { id: 'notify.content', page: 'notifications', section: 'Avisos do sistema', label: 'Mostrar o texto da mensagem', keywords: ['notificação', 'aviso', 'conteúdo', 'pré-visualização', 'privacidade', 'popup'] },

  // Atalhos
  { id: 'shortcuts.toggle-mute', page: 'shortcuts', label: 'Atalho de mutar', keywords: ['tecla', 'mute', 'microfone', 'atalho global', 'keybind', 'hotkey'] },
  { id: 'shortcuts.toggle-deafen', page: 'shortcuts', label: 'Atalho de ensurdecer', keywords: ['tecla', 'deafen', 'fone', 'keybind', 'hotkey'] },
  { id: 'shortcuts.toggle-share', page: 'shortcuts', label: 'Atalho de compartilhar tela', keywords: ['tecla', 'stream', 'transmitir', 'keybind', 'hotkey'] },
  { id: 'shortcuts.leave-call', page: 'shortcuts', label: 'Atalho de sair da call', keywords: ['tecla', 'desligar', 'keybind', 'hotkey'] },
  { id: 'shortcuts.show-window', page: 'shortcuts', label: 'Atalho de mostrar o Resenha', keywords: ['tecla', 'abrir janela', 'trazer pra frente', 'keybind', 'hotkey'] },
  { id: 'shortcuts.all', page: 'shortcuts', label: 'Todos os atalhos', keywords: ['lista de atalhos', 'teclado', 'ctrl', 'keybinds', 'comandos'] },
  { id: 'shortcuts.hyprland', page: 'shortcuts', label: 'Atalhos no Hyprland', keywords: ['bind', 'hyprland.conf', 'config', 'segundo plano'], hyprland: true },

  // Aplicativo
  { id: 'app.autostart', page: 'app', section: 'Ao ligar o computador', label: 'Abrir o Resenha ao ligar o computador', keywords: ['iniciar com o sistema', 'inicialização', 'autostart', 'boot', 'login', 'startup'], desktop: true },
  { id: 'app.hidden', page: 'app', section: 'Ao ligar o computador', label: 'Começar minimizado', keywords: ['minimizado', 'segundo plano', 'escondido', 'bandeja'], desktop: true },
  { id: 'app.tray', page: 'app', section: 'Janela', label: 'Ícone na bandeja', keywords: ['tray', 'bandeja', 'barra de tarefas', 'ícone', 'system tray'], desktop: true },
  { id: 'app.close', page: 'app', section: 'Janela', label: 'Fechar só esconde a janela', keywords: ['minimizar ao fechar', 'segundo plano', 'fechar', 'x'], desktop: true },
  { id: 'app.zoom', page: 'app', section: 'Janela', label: 'Tamanho da interface', keywords: ['zoom', 'escala', 'tamanho da letra', 'fonte', 'aumentar', 'diminuir', 'ctrl +'], desktop: true },
  { id: 'app.update', page: 'app', section: 'Atualizações', label: 'Atualizações', keywords: ['atualizar', 'versão', 'update', 'nova versão', 'baixar atualização', 'novidades'] },

  // Plataforma (dono)
  { id: 'platform.signup', page: 'platform', label: 'Cadastro', keywords: ['convite', 'cadastro aberto', 'registro', 'criar conta', 'turnstile'], staff: true },
  { id: 'platform.accounts', page: 'platform', label: 'Contas', keywords: ['usuários', 'banir', 'moderação', 'pessoas'], staff: true },
  { id: 'platform.storage', page: 'platform', label: 'Espaço usado', keywords: ['armazenamento', 'anexos', 'disco', 'arquivos', 'storage'], staff: true },
]

/** Sem acento, minúsculo, só letras/números (o resto vira espaço). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@+]+/gu, ' ')
    .trim()
}

/** Quantas letras trocar, tirar ou pôr pra ir de `a` a `b` (para cedo passando de `max`). */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/** Quanto uma palavra da busca bate com as palavras de um texto (0 = não bate). */
function wordScore(term: string, words: string[]): number {
  let best = 0
  for (const word of words) {
    if (word === term) return 3
    if (word.startsWith(term)) best = Math.max(best, 2.5)
    else if (term.length >= 3 && word.includes(term)) best = Math.max(best, 1.5)
    else if (term.length >= 4) {
      // Erro de digitação: uma letra (duas nas palavras compridas), comparando com o começo da palavra.
      const max = term.length >= 7 ? 2 : 1
      const head = word.slice(0, term.length + 1)
      if (distance(term, word, max) <= max || distance(term, head, max) <= max) best = Math.max(best, 1)
    }
  }
  return best
}

export interface SettingContext {
  staff: boolean
  desktop: boolean
  hyprland: boolean
}

/** Configurações que batem com a busca, das mais certeiras pras menos. */
export function searchSettings(query: string, context: SettingContext): SettingEntry[] {
  const whole = fold(query)
  const terms = whole.split(' ').filter(Boolean)
  if (terms.length === 0) return []
  const results: { entry: SettingEntry; score: number }[] = []
  for (const entry of SETTINGS) {
    if ((entry.staff && !context.staff) || (entry.desktop && !context.desktop) || (entry.hyprland && !context.hyprland)) continue
    const label = fold(entry.label).split(' ')
    const place = fold(`${PAGE_LABEL[entry.page]} ${entry.section ?? ''}`).split(' ')
    const keywords = fold(entry.keywords.join(' ')).split(' ')
    let score = 0
    let all = true
    for (const term of terms) {
      // O nome vale mais que as palavras-chave, que valem mais que a página.
      const hit = Math.max(wordScore(term, label) * 2, wordScore(term, keywords) * 1.4, wordScore(term, place))
      if (hit === 0) {
        all = false
        break
      }
      score += hit
    }
    // A busca inteira é o nome ou uma das palavras-chave: é isso que a pessoa quer.
    if (all && (fold(entry.label) === whole || entry.keywords.some((k) => fold(k) === whole))) score += 3
    if (all) results.push({ entry, score })
  }
  return results.sort((a, b) => b.score - a.score).map((r) => r.entry)
}
