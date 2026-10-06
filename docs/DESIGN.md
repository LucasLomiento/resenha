# Design do Resenha

Guia da interface: o que o app parece, por quê, e como fazer tela nova sem destoar. Os tokens estão em `app/src/renderer/app.css`, os componentes em `app/src/renderer/ui/kit/` e os protótipos das telas que vão chegar em `app/src/renderer/ui/proto/`.

## Princípios

1. **Um lugar pra cada coisa.** Se um controle aparece em dois lugares, um deles sai. A câmera e a tela ficam só no dock; a qualidade da transmissão fica no diálogo e no painel ao vivo, não nas configurações.
2. **Nada muda de lugar.** O botão troca de ícone, de cor ou de texto, mas não de posição, em nenhum estado e em nenhum tamanho de janela. O e2e confere isso no dock.
3. **Texto só quando ajuda a decidir.** Rótulo curto, descrição de uma linha, e só se mudar a escolha de alguém. Jargão técnico (codec, RNNoise, bitrate) fica em "Avançado" ou some.
4. **Escuro de verdade, com uma pitada de marca.** Superfícies em tinta fria levemente violeta; o degradê do ícone aparece só em momentos de marca (logo, tela de entrada, boas-vindas do canal, criar servidor).
5. **Calmo por padrão, vivo quando importa.** Cinza na maior parte do tempo; verde quando alguém fala, vermelho quando é ao vivo, menção ou perigo, violeta quando é seu (seleção, sua reação, seu link).
6. **Teclado e leitor de tela contam.** Todo botão de ícone tem nome; o status tem forma além da cor; o Esc fecha só a camada de cima.

## Identidade

- **Ícone:** balão rindo com headset, sobre squircle violeta → roxo → coral (`app/build/icon.svg`).
- **Degradê da marca:** `--brand-gradient` (#6f7dff → #9150ff → #ff5a7a). Usar pouco: logo, brilho da tela de entrada, borda do ícone de boas-vindas do canal, botão de criar servidor.
- **Fundo da janela:** um brilho violeta bem fraco no canto superior esquerdo (7%), que some atrás do painel.
- **Forma:** cantos arredondados em todo lugar (10 px em controles, 14 px em cartões e no painel, 18 px em modais), squircle nos ícones de servidor.

## Tokens

### Cor

| Token | Valor | Uso |
| --- | --- | --- |
| `--bg-canvas` | #0b0b10 | Janela. Barra lateral e trilho ficam direto aqui. |
| `--bg-panel` | #131319 | Painel principal (chat, call, configurações por cima). |
| `--bg-raised` | #1a1a22 | Cartões, dock, compositor, menus, modais. |
| `--bg-overlay` | #22222c | Dicas (tooltips). |
| `--bg-input` | #0e0e13 | Campos, segmentados, trilhos de medidor. |
| `--hover` / `--selected` / `--press` | branco 4,5% / 7,5% / 10% | Estados por cima de qualquer superfície. |
| `--line` / `--line-strong` | branco 6,5% / 11% | Fios e bordas (sempre `box-shadow` de 1 px). |
| `--fg` | #ededf3 | Texto principal. |
| `--fg-2` | #a6a6b6 | Secundário (descrições, ícones). |
| `--fg-3` | #75758a | Apagado (rótulos de seção, horários, placeholder). |
| `--fg-4` | #4d4d5c | Desligado. |
| `--accent` | #6a5cf6 | Preenchimento com texto branco (botão principal, interruptor ligado). Contraste 4,7:1. |
| `--accent-fg` | #ada4ff | Acento como texto ou ícone sobre o escuro (links, sua reação, sua câmera ligada). |
| `--accent-soft` / `--accent-line` | violeta 15% / 45% | Fundo e borda de coisas "suas" (reação, chip escolhido). |
| `--green` | #34d399 | Falando, online, na call. |
| `--yellow` | #fbbf24 | Ausente, aviso. |
| `--red` | #ff5c72 | Ao vivo, menção, mutado, perigo. Preenchimento com texto branco usa #dc3a50. |

Regras: nunca cor solta no componente; nada de cinza puro (os neutros puxam pro violeta); vermelho é sinal, não decoração.

### Tipografia

Fonte **Geist** (variável, empacotada com `@fontsource-variable/geist`) e **Geist Mono** pra código, atalhos e convites. Nada vem de CDN (o CSP só aceita fonte do próprio app).

| Token | px | Uso |
| --- | --- | --- |
| `--text-3xl` | 28 | Boas-vindas do canal. Peso 650, tracking -0,025em. |
| `--text-2xl` | 22 | Título de página (configurações, login). 650. |
| `--text-xl` | 18 | Título de painel, nome no cartão de perfil. 600–650. |
| `--text-lg` | 15 | Texto das mensagens e título do canal. |
| `--text-md` | 14 | Interface e rótulos (base do `body`). |
| `--text-sm` | 13 | Itens, descrições, botões. |
| `--text-xs` | 12 | Legendas, horários, rótulos de seção. |
| `--text-2xs` | 11 | Selos. |

Rótulos de seção em caixa normal (não em CAIXA ALTA), 12 px, peso 500, `--fg-3`. Números que mudam (ping, %, contadores) com `font-variant-numeric: tabular-nums`.

### Espaço, tamanho e forma

- **Grade de 4 px:** `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48.
- **Alturas de controle:** `--h-sm` 28 · `--h-md` 34 · `--h-lg` 40 · `--h-xl` 44. Itens de navegação 32; linhas de configuração 56 no mínimo; cabeçalhos `--header-h` 52.
- **Raios:** `--r-xs` 4 · `--r-sm` 6 · `--r-md` 8 · `--r-lg` 10 · `--r-xl` 14 · `--r-2xl` 18 · `--r-full`.
- **Sombras:** `--shadow-sm` (dock, painel), `--shadow-md` (dicas, barra de ações), `--shadow-lg` (menus, modais, miniatura). Sempre junto de um fio de 1 px (`0 0 0 1px var(--line-strong)`) e do `--highlight` (brilho de 1 px no topo).
- **Movimento:** `--t-fast` 100 ms (hover), `--t` 160 ms (troca de estado), `--t-slow` 260 ms (entrada de modal/tela). Curva `--ease`. Entradas com `rs-pop-in` (sobe 6 px e aparece). Tudo respeita `prefers-reduced-motion`.
- **Camadas:** miniatura 30 · configurações 35 · popover 40 · modal 50 · visualizador de imagem 70 · avisos 90 · dicas 100. As configurações (tela cheia) ficam abaixo de menus e modais, porque eles abrem de dentro delas.

## Layout

```
┌──────┬────────────┬──────────────────────────────────────────┐
│trilho│ barra      │ painel (solto, 8 px de margem, raio 14)   │
│ 72   │ lateral    │ ┌ cabeçalho 52 ──────────────────────────┐│
│      │ 248        │ │                               │ membros ││
│      │ (no fundo  │ │ mensagens                     │ 248     ││
│      │ da janela) │ │                               │         ││
│      │ ┌ dock ──┐ │ │ compositor                    │         ││
│      │ └────────┘ │ └───────────────────────────────┴─────────┘│
└──────┴────────────┴──────────────────────────────────────────┘
```

- Hoje não existe o trilho (é um grupo só); ele chega com os vários servidores.
- **Barra lateral e trilho direto no fundo** da janela; só o conteúdo é um painel. Menos caixas, cara de app novo.
- O cabeçalho da barra lateral e o do painel têm a mesma altura (52) e o mesmo centro (y = 34), e o dock termina na mesma linha do painel (8 px da borda).
- **Dock** (rodapé da barra lateral): um cartão só com a call em cima (status, sinal, sair; Câmera e Tela) e você embaixo (avatar com status, nome, mutar, ensurdecer, configurações). A call aparece por cima sem mexer na sua linha.
- **Janela mínima (940 × 560):** tudo cabe. Nos protótipos, abaixo de ~780 px de painel a lista de membros e o tópico do canal saem (container query) e a coluna "Agora" do início some.
- **Configurações em tela cheia:** navegação à esquerda (236), página à direita (até 660), fechar no canto com "Esc". A navegação e o título nunca mudam de lugar entre páginas (o e2e confere).

## Componentes (`ui/kit`)

Tudo exportado por `ui/kit/index.ts`. Nenhum componente do kit importa o store: servem pro app e pros protótipos.

| Componente | Pra quê | Detalhes |
| --- | --- | --- |
| `Button` | Ações com texto. | `variant`: primary (uma por tela), secondary, ghost, danger-soft (sair, apagar no meio da página), danger (só na confirmação). `size` sm/md/lg, `icon`, `loading`, `full`. |
| `IconButton` | Ações só com ícone. | `label` é obrigatório (vira nome acessível e dica). `size` 28/32/36/40, `variant` ghost/subtle/glass (sobre vídeo), `tone` + `active` pros estados ligados (mutado = danger, câmera = accent). |
| `Icon` | O único jeito de pôr ícone. | Nomes do Resenha (`mic`, `screen`, `phone-off`…), mapeados pro Lucide. Traço fixo de 1,75 px em qualquer tamanho. |
| `tooltip` (ação) | Dica no lugar do `title` nativo. | `use:tooltip={'Texto'}` ou `{ text, placement, shortcut }`. Aparece em 420 ms; as seguintes, na hora. |
| `TextField` | Campo de texto. | Rótulo em cima, `hint` de uma linha, `error` com ícone, `icon` na esquerda, `mono` pra códigos. |
| `Select` | Lista curta de opções do sistema (dispositivos). | Nativo, estilizado; seta própria. |
| `Switch` | Liga/desliga que vale na hora. | É um checkbox com `role="switch"`: rótulo clicável e teclado funcionam. |
| `Segmented` | 2–4 opções exclusivas, curtas. | Marcador desliza. Com `hint`, vira duas linhas (ex.: Fluidez / Jogos e vídeos). |
| `RadioGroup` | Opções exclusivas que pedem uma frase cada. | Dentro de um cartão (`Section`). |
| `Tabs` | Filtros de uma lista (Amigos: Online, Todos, Pendentes). | Pílulas; `count` e `alert` (contador vermelho). |
| `Slider` | Volume. | Trilho preenchido com o acento. |
| `Meter` | Nível do microfone. | Com `threshold`, a própria barra vira o controle do limiar (marca branca arrastável). |
| `Avatar` | Pessoa ou servidor. | Foto ou degradê com iniciais (sem "de/da/do"), `status`, `speaking` (anel verde), `square` (servidor), `cutout` = cor do fundo atrás. |
| `StatusDot` | Status. | Forma além da cor: bolinha (online), lua (ausente), menos (não perturbe), anel (offline). |
| `Badge` | Selos. | neutral/accent/success/warning/danger, `count` (menções), `live` (AO VIVO com pulso), `dot` (cor de cargo). |
| `Kbd` | Atalhos. | "Ctrl + Shift + M" vira três teclas. |
| `SignalBars` | Qualidade da conexão. | Três barras com a cor do ping; o número fica na dica. |
| `NavItem` | Item de navegação (canal, conversa, página). | `active`, `unread` (texto forte + marquinha na borda), `muted`, `count`, `leading`/`trailing`. |
| `Section` + `Row` | Configurações. | Cartão com linhas separadas por fio. `Row`: rótulo + descrição à esquerda, controle à direita; `stack` (controle embaixo, largura toda), `indent` (depende da de cima), `disabled`. |
| `PageHeader` | Título de página. | Com ações à direita. |
| `SettingsLayout` | Configurações em tela cheia. | Navegação com títulos, separadores e item de perigo (Sair). |
| `Modal` | Diálogo. | sm/md/lg/xl (400–760), título, descrição opcional, rodapé à direita. Esc e clique fora fecham. Foco entra e volta. |
| `Popover` | Painel flutuante ancorado. | Encosta no alvo, vira se não couber, fecha com clique fora e Esc. `inline` pra protótipo. |
| `Menu` | Menu de contexto e de opções. | Itens com ícone, `hint` (atalho/valor), `checked`, `danger`, separador e título de grupo. Setas e Enter. |
| `EmptyState` | Lista vazia. | Ícone em azulejo com borda da marca, título, uma frase, ação opcional. |
| `Spinner` | Carregando. | Só onde a espera passa de ~300 ms. |

**Camadas e Esc:** modal, menu, popover, configurações e visualizador de imagem entram numa pilha (`kit/layers.ts`). O Esc fecha só a de cima. Campo que usa o Esc pra si (editar mensagem, renomear canal) marca `data-own-escape`.

## Ícones

- Um conjunto só: **Lucide** (`@lucide/svelte`), sempre pelo `Icon` do kit.
- Traço de 1,75 px absoluto (não engrossa nem afina com o tamanho).
- Tamanhos: 14 (dentro de texto e selos), 16 (botões pequenos, menus), 18 (padrão), 20 (cabeçalhos, botões grandes), 24 (estados vazios).
- O ícone mostra a coisa, não o estado ao contrário: o botão de câmera desligada usa o ícone da câmera (sem risco); o estado ligado é a cor. Risco só onde ele é o estado (microfone mutado, fone ensurdecido).

## Textos

**Tom:** amigo que manja, falando direto. Português do Brasil, frases curtas, sem ponto de exclamação, sem "por favor", sem "você deseja…?".

- **Rótulos:** substantivo ou verbo curto, em caixa normal. "Microfone", "Saída", "Câmera". "Só transmitir quando eu falar".
- **Botões:** verbo no infinitivo dizendo o que acontece. "Compartilhar", "Gerar convite", "Sair", "Apagar". O botão de confirmar repete o verbo do título ("Apagar mensagem?" → Apagar).
- **Descrições:** uma linha, só se mudar a decisão. "Útil pra quem usa caixa de som." Nada de explicar o óbvio ("Clique aqui para…").
- **Erros:** o que aconteceu + o que fazer, sem culpar. "A mensagem não foi enviada. Tente de novo." "Sem acesso ao microfone." Erro de campo embaixo do campo, em vermelho, com ícone.
- **Avisos (toasts):** uma frase. Erro some em 6 s, informação em 4,5 s.
- **Estados vazios:** título que diz o que é + uma frase do que fazer. "Nada fixado ainda" / "Fixe mensagens importantes pra achar depois."
- **Números:** "1 pessoa", "3 pessoas" (plural certo sempre); horas "14:32"; datas "Hoje", "Ontem", "sexta, 3 de outubro".
- **Coloquial, mas escrito:** "pra" e "tá" podem; gíria que trava leitura, não.

**Vocabulário fixo** (usar sempre o mesmo termo):

| Use | Não use |
| --- | --- |
| call, Na call, Sair da call | chamada de voz, voz conectada |
| Compartilhar tela · Ao vivo · Parar | transmitir (no botão), stream, live |
| Mutar / Desmutar · Ensurdecer / Voltar a ouvir | silenciar o microfone |
| Mensagem privada · Mensagens privadas | DM, mensagem direta |
| Servidor (o grupo, na arquitetura nova) | guild, comunidade |
| Canal · Categoria · Cargo · Convite | sala, role |
| Configurações | preferências, opções |
| Sair da conta | deslogar, logout |
| Apelido (hoje) → Nome de exibição e Nome de usuário (contas novas) | nick, handle |

## Telas de hoje (o que mudou)

| Tela | Antes | Agora |
| --- | --- | --- |
| Entrar / criar conta | Cartão com rótulos em caixa alta e link "Tenho um convite…". | Cartão com o brilho da marca, título que diz o que a tela faz ("Entrar no Resenha" / "Criar conta"), campos grandes, erro em caixa vermelha, troca de modo embaixo do cartão. |
| Barra lateral | Três rótulos em caixa alta, dois "+" iguais, bolinha de conexão no topo. | "Canais", "Voz", "Mensagens privadas"; um menu no nome do grupo (admin) com Convidar e Configurações; conexão só aparece quando cai (pílula "Conectando…" no painel). Ping virou barras de sinal com o número na dica. |
| Voz | Painel de voz + barra do usuário separados; câmera repetida na tela da call. | Um dock só, botões sempre no mesmo lugar; a tela da call mostra só os blocos. |
| Chat | "Hoje às 14:32" ao lado do nome + divisória com a data (data duas vezes). | Hora ao lado do nome, data só na divisória ("Hoje", "Ontem"); confirmação antes de apagar (Shift + clique apaga direto); prévia de anexos em miniaturas com progresso. |
| Compartilhar tela | Qualidade com "(QHD)", "Prioridade" com parênteses, texto longo do áudio. | Qualidade e "Priorizar" com uma linha de dica cada; "Compartilhar o som" com uma frase por sistema; apps como chips. |
| Painel ao vivo | Qualidade, prioridade e codec; contagem também no painel de voz. | Qualidade e priorizar; contagem só aqui; Ver minha tela e Parar. O codec foi pra Avançado. |
| Player | Botões com `title` nativo. | Barra de vidro com dicas próprias, mesma ordem sempre; nome de quem transmite com selo AO VIVO. |
| Configurações | Modal 680 × 680 com seis abas e muito texto. | Tela cheia: Minha conta, Voz e vídeo, Notificações, Atalhos, Aplicativo, Grupo, Sair da conta. "Comprimir imagens" saiu (sempre comprime); codec, estatísticas, eco e ganho em "Avançado"; "RNNoise/Do Chromium/Desligada" virou "Forte/Leve/Desligada"; versão aparece uma vez só (Aplicativo). |
| Avisos | Fundo vermelho ou azul chapado. | Cartão escuro com ícone colorido. |

## Telas que vão chegar (protótipos)

Cada uma tem um protótipo estático com dados de exemplo em `ui/proto`. Os nomes de campo dos exemplos (`proto/data.ts`) seguem o protocolo novo (`shared/protocol.ts` da 0.6+), então ligar nos dados é trocar `data.ts` pelo store.

**Como ver:** `VITE_PROTO=1 npm run dev:app` (abre direto nos protótipos), ou `#proto` / `#proto/<tela>` no endereço (num app aberto: F12 e `location.hash = '#proto'`). Funciona até num navegador comum pelo servidor do Vite, porque o modo protótipo não liga no servidor. Alt + ← / → passa de tela; o seletor fica embaixo. `/clean` no fim esconde o seletor.

**Capturas:** `npm -w app run proto:shots -- <pasta>` (com `PROTO_SMALL=1`, também na janela mínima). As do app de hoje saem do e2e com `RESENHA_SHOTS=<pasta>`.

### Trilho de servidores — `#proto/server`
- 72 px, direto no fundo. Início (logo do app) no topo, fio, servidores (squircle 44, raio 16 → 13 no hover/aberto), "+" verde no fim (criar ou entrar).
- Marquinha branca na borda esquerda: 8 px = novidade, 20 px = hover, 36 px = aberto. Menções num contador vermelho no canto.
- Servidor sem ícone: degradê do id com as iniciais (sem "de/da/do").
- **Precisa de dado:** `GuildInfo.icon` (imagem), não lidas e menções por servidor (somar `ReadState` dos canais).

### Barra do servidor — `#proto/server`, `#proto/server-menu`
- Cabeçalho com o nome e seta; abre o menu do servidor: Convidar pessoas, Configurações do servidor, Criar canal, Criar categoria · Notificações (valor atual à direita), Silenciar · Sair do servidor (vermelho). Itens que a pessoa não pode usar não aparecem.
- Categorias em caixa normal com seta (recolhe) e "+" no hover (criar canal, se puder).
- Canal: `#` (privado: cadeado), não lido = negrito + marquinha, menções = contador, silenciado = apagado.
- Canal de voz com quem está dentro: avatar 22 (anel verde falando), câmera, mutado/ensurdecido em vermelho, AO VIVO (clica pra assistir).
- Dock igual ao de hoje; o subtítulo da call diz "canal · servidor".
- **Precisa de dado:** `Channel.parentId`, `overwrites` (privado), `ReadState`, `NotifySettings`.

### Chat completo — `#proto/server`, `#proto/server-reply`
- Cabeçalho: `#` + nome + tópico (some se faltar espaço) · Fixadas, Membros (ligado), Buscar.
- **Resposta:** linha acima da mensagem com avatar 16, nome e começo do texto, ligada ao avatar por uma curva. No compositor, barra "Respondendo a Fulano" com ×.
- **Menção:** pílula violeta (`@Fulano`, `#canal`, `@everyone`). Se me menciona, a linha inteira ganha fundo violeta fraco e barra na borda esquerda.
- **Reações:** pílulas com emoji e número; a sua em violeta; "+" aparece no hover.
- **Prévia de link:** cartão com barra da cor do site, nome do site, título (link), descrição e imagem 16:9.
- **Fixada:** alfinete pequeno ao lado da hora.
- **Barra de ações no hover:** Reagir, Responder, Fixar, Mais.
- **Sugestão de @menção:** lista acima do compositor (Pessoas, Cargos, @everyone com "Notifica todo mundo"), setas e Tab.
- Conversa privada não tem cor de cargo nos nomes.
- **Precisa de dado:** `Message.replyTo`, `reactions` (com `userIds` pra saber se é minha), `mentions`/`mentionRoles`/`mentionEveryone` (o "me menciona" sai daqui), `pinned`, `embeds`; **cor do site no embed** (opcional, sem ela a barra fica cinza); **largura e altura dos anexos de imagem/vídeo** (pra reservar o espaço e a rolagem não pular).

### Lista de membros — `#proto/server`
- 248 px dentro do painel, com fio à esquerda. Grupos: cargos separados (hoist) do mais alto pro mais baixo, depois "Online", depois "Offline" (apagado); cada um com "— N".
- Linha 44: avatar 32 com status, nome na cor do cargo, coroa amarela pro dono, embaixo o status personalizado ou "Na call · canal".
- Some quando o painel fica estreito (abaixo de ~780 px).
- **Precisa de dado:** `Role.hoist`, `Role.color`, `Member.roles`/`nick`, `Presence` (status + texto), dono (`GuildInfo.ownerId`).

### Cartão de perfil — `#proto/profile`
- 320 px, abre ao clicar em nome ou avatar (em qualquer lugar). Faixa com a cor do perfil, avatar 80 sobreposto com status, nome, nome de usuário (e o nome original, se tiver apelido), status personalizado em balão, Sobre mim, Membro desde, Cargos (com + pra quem pode dar cargo), Mensagem e Ligar.
- Na conversa privada vira o painel da direita, sem os botões, com "No Resenha desde" e "Servidores em comum".
- **Precisa de dado:** `User.accent`, `bio`, `avatar`, `Member.joinedAt`; **`createdAt` no User público** (hoje só no `Me`) e **lista de servidores em comum** (ou tirar essas linhas).

### Fixadas — `#proto/pins`
- Popover de 380 abaixo do alfinete: título com contador, cartões com autor, hora, texto, anexo; "Ir" e desafixar.
- **Precisa de dado:** `chat.pins`.

### Busca — `#proto/search`
- O campo do cabeçalho cresce quando tem texto; os resultados tomam o lugar da lista de membros: contador, Recentes/Relevantes, cartões por canal com o termo marcado em amarelo. Clicar leva à mensagem (`chat.history` com `around`).
- **Precisa de dado:** `chat.search` (total e mensagens).

### Ctrl+K — `#proto/switcher`
- Caixa de 580 no topo, sobre fundo escurecido. Resultados por grupo (Canais, Pessoas, Servidores) com as letras que bateram em violeta; o primeiro já vem escolhido (Enter). Dica: `@` pessoas, `#` canais.
- **Precisa de dado:** nada novo (canais, pessoas e servidores que o app já tem).

### Menus de contexto — `#proto/menus`
- Mensagem: Reagir, Responder, Fixar, Copiar texto, Copiar link · Apagar.
- Membro: Perfil, Mensagem, Cargos · (Na call) Mutar pra todos, Mover pra…, Desconectar · Castigar…, Expulsar, Banir (vermelho). Só aparece o que a pessoa tem permissão pra fazer.
- **Precisa de dado:** permissões efetivas (`ready.permissions`).

### Status — `#proto/status`
- Abre no seu avatar do dock: status personalizado (balão + lápis), Online, Ausente (fica assim sozinho depois de 10 min parado), Não perturbe (sem notificações), Invisível (aparece offline), Editar perfil.
- **Precisa de dado:** `presence` (status + texto).

### Início: amigos — `#proto/home`, `#proto/home-pending`, `#proto/home-add`
- Barra: "Encontrar conversa" (abre o Ctrl+K), Amigos (com pedidos pendentes), Mensagens privadas com "+", conversas com avatar, nome, status ou prévia da última mensagem e contador.
- Página: abas Online, Todos, Pendentes; botão Adicionar amigo. Linhas com status; Mensagem e Mais. Pendentes: Recebidos (aceitar/recusar) e Enviados (cancelar). Adicionar: campo do nome de usuário, confirmação em verde, seu nome de usuário pra copiar.
- Coluna "Agora" (some em janela pequena): calls com amigos dentro, quem está ao vivo, Entrar.
- **Precisa de dado:** `Friend`, `DmChannel.unread`; **prévia da última mensagem** em `DmChannel` (texto curto) e **em que call cada amigo está** (pra coluna "Agora").

### Mensagem privada — `#proto/dm`
- Igual ao canal, com avatar e status no cabeçalho, Ligar e Chamada de vídeo, e o perfil à direita.
- **Precisa de dado:** `call.ring` e afins (ligação na conversa, roadmap 1.0).

### Criar ou entrar num servidor — `#proto/create-server`, `#proto/create-server-form`, `#proto/join-server`
- O "+" do trilho abre a escolha: Criar meu servidor / Entrar com convite.
- Criar: ícone (tracejado, clica pra escolher) e nome; Voltar e Criar.
- Entrar: código ou link em mono; prévia do servidor (ícone, nome, online · membros, quem convidou) antes de entrar.
- **Precisa de dado:** `InvitePreview` (já tem `memberCount` e `inviter`); **quantos online** é opcional.

### Configurações do servidor — `#proto/server-settings` (e `-roles`, `-members`, `-invites`, `-bans`, `-audit`)
- Mesma tela cheia das configurações do app. Navegação: Visão geral, Cargos, Membros, Convites, Banimentos, Registro de auditoria (só o que a pessoa pode ver).
- **Visão geral:** ícone (trocar/remover) e nome; notificação padrão; zona de perigo (Transferir, Excluir). Mudança pendente mostra a barra "Você tem alterações não salvas" (Desfazer / Salvar) presa embaixo.
- **Cargos:** lista à esquerda (arrastar pra ordenar, cor, quantos têm), editor à direita: nome, cor (amostras + sem cor), mostrar separado, qualquer um pode mencionar, e permissões por grupo (Geral, Mensagens, Voz, Moderação) com uma linha de explicação só nas que precisam. Administrador avisa "Dê só pra quem confia muito".
- **Membros:** busca, filtro por cargo, linhas com nome (cor do cargo), nome de usuário, cargos, data de entrada, menu de ações.
- **Convites:** criar (vale por, usos) e lista ativa com código, quem criou, usos, quando vence, copiar e revogar.
- **Banimentos:** quem, motivo, por quem e quando; Desbanir.
- **Auditoria:** filtros por ação e por pessoa; linhas com ícone colorido pelo tipo, "Fulano fez tal coisa em tal lugar", detalhe e quando.
- **Precisa de dado:** `Role` com `permissions` (bits do `P`), `Invite`, `Ban`, `AuditEntry`; o texto de cada ação sai do `action` + nomes resolvidos.

### Conta — `#proto/account` (e `-devices`, `-password`, `-privacy`)
- As configurações do app ganham "Conta" em cima (Perfil, Aparelhos, Senha, Privacidade) e "App" embaixo (as páginas de hoje); Sair da conta no fim.
- **Perfil:** foto, nome de exibição, nome de usuário (com @, mono, regra numa linha), sobre mim (contador), cor do perfil; prévia ao vivo do cartão (desce pra baixo em janela pequena).
- **Aparelhos:** cada sessão com ícone, onde e quando; "Este aparelho"; Sair por aparelho; Sair dos outros.
- **Senha:** atual, nova (medidor de força), repetir (erro embaixo); trocar desconecta os outros.
- **Privacidade:** quem pode mandar mensagem privada (Qualquer pessoa / Quem está nos meus servidores / Só amigos), Bloqueados, Baixar meus dados, Excluir conta.
- **Precisa de dado:** `SessionInfo` (o tipo do aparelho pro ícone pode sair do texto `device`), `DmPolicy`, lista de bloqueados; rotas pra exportar dados e excluir conta (roadmap 1.0).

### Kit — `#proto/kit`
Galeria de todos os componentes e tokens, pra conferir de olho quando mudar algo no kit.

## Acessibilidade

- Foco visível em tudo (anel violeta claro de 2 px, com folga de 2 px).
- Botão de ícone sempre com nome (`label`), que também é a dica.
- Status com forma, não só cor. Ping com o número na dica e em texto escondido pra leitor de tela.
- Contraste: texto principal ~15:1, secundário ~7:1, apagado ~4:1 no painel; botão principal 4,7:1.
- Modais e menus prendem o foco e devolvem pra onde estava; Esc fecha só a camada de cima.
- Animações curtas e desligadas com `prefers-reduced-motion`.

## Checklist de tela nova

- [ ] Só tokens do `app.css` e componentes do kit (nada de cor, raio ou tempo solto).
- [ ] Nenhum controle repetido em outro lugar da mesma tela.
- [ ] Botões no mesmo lugar em todos os estados; conferido na janela mínima (940 × 560).
- [ ] Todo texto revisado com o guia: rótulo curto, uma linha de descrição no máximo, vocabulário fixo.
- [ ] Ícones pelo `Icon`; botões de ícone com `label`.
- [ ] Estado vazio, carregando e erro desenhados.
- [ ] Captura conferida (e2e com `RESENHA_SHOTS` ou `test/proto-shots.mjs`).

## Notas pra quem mexe na lógica

- `settings.compressImages` não aparece mais na interface e o compositor sempre diminui a imagem; o campo pode sair de `lib/settings.svelte.ts` quando for conveniente.
- Os rótulos de atalho exibidos ficam na página de Atalhos (`ui/settings/ShortcutsPage.svelte`); `lib/shortcuts.ts` continua igual.
- O e2e acha os elementos pelos nomes acessíveis (`getByRole('button', { name })`), não mais por `title`. Espera o login por `.shell[data-status=open]`.
