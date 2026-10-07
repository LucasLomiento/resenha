# Arquitetura (a partir da 1.0)

Tudo no Cloudflare Workers + Durable Objects (DO), sem banco externo. Cada DO é um "mini servidor" com SQLite próprio, consistente e de um processo só. Dividimos assim:

```
                       ┌──────────────────────────────┐
  app ──HTTPS────────▶ │ Worker (rotas, CORS, arquivos)│
   │                   └──────┬───────────┬───────────┘
   │                          │ RPC        │ RPC
   │                 ┌────────▼───────┐  ┌─▼──────────────────────┐
   │                 │ Directory (1)  │  │ Guild (1 por servidor) │◀──WS── app (1 por servidor)
   │                 │ contas, sessões│  │ canais, mensagens,     │
   │                 │ limites, mídia,│  │ anexos, membros, cargos│
   │                 │ servidores,    │  │ voz/sinalização        │
   │                 │ convites, amigos│ └────────────────────────┘
   │                 └────────▲───────┘
   │                          │ RPC
   │                 ┌────────┴───────┐   ┌──────────────────────┐
   └──────WS───────▶ │ Home (1 por    │◀─▶│ Conversation (1 por  │
                     │ usuário): DMs, │RPC│ conversa privada):   │
                     │ amigos, status │   │ mensagens e anexos   │
                     └────────────────┘   └──────────────────────┘
```

## Por que assim
- **Directory é um DO, não D1.** O PBKDF2 das senhas estoura o limite de CPU de 10 ms de um Worker no plano grátis. Dentro de um DO, o limite é bem maior. Ficar em um DO também mantém tudo consistente (sem réplica atrasada) e não exige criar banco.
- **Um Guild por servidor.** O chat e a voz de um servidor ficam num lugar só, isolados dos outros, e escalam por servidor.
- **O app abre 1 WebSocket por servidor + 1 pessoal (Home).** Com hibernação, conexão parada não custa nada. É mais simples (e mais barato em requisições) do que um gateway central repassando tudo.
- **DMs num Conversation por conversa, passando pelo Home.** O app manda e recebe DMs só pelo socket pessoal: o Home repassa pro Conversation, que guarda e entrega pros Homes dos dois.

## Queda de conexão sem derrubar a call
Voz, câmera e tela vão direto entre os PCs (P2P); o servidor só apresenta as pessoas e repassa a sinalização. Então uma queda do WebSocket não precisa derrubar nada:
- **Mesmo connId em toda reconexão.** Cada conexão do app manda no `auth` uma chave aleatória dela (a mesma até fechar o app). O servidor tira o connId de `SHA-256(conta + chave)` (`server/src/resume.ts`): quem reconecta volta com o mesmo connId, e ninguém de outra conta chega nele.
- **Quem cai sem avisar vira "fantasma" por 30 s.** Continua na call e online pros outros, e a sinalização que chega pra ele fica guardada. Voltando a tempo, o `ready` vem com `resumed: true` e tudo segue. Se a conexão antiga ainda parecia aberta (caiu sem fechar), a nova toma o lugar dela (código 4005). Fechar de propósito (1000, 1001, sessão encerrada, expulso…) sai na hora; o app fecha as conexões assim ao sair.
- **No app, reconectar não desfaz as conexões P2P.** Se o servidor esqueceu a call (reiniciou, ou passou dos 30 s), o app entra de novo numa mensagem só, já com tela e câmera como estavam. Cada RTCPeerConnection tem um id que vai na sinalização (`pc` e `ack`): se um lado precisou recomeçar a dele, o outro percebe e recomeça junto, e quem assistia uma tela volta a assistir sozinho. Quem some da call ainda tem 15 s pra voltar antes de a conexão P2P fechar.
- **Conexão morta é percebida em ~10 s.** O app manda `ping` a cada 20 s (o DO responde `pong` sozinho, sem acordar) e larga a conexão se a resposta não vier em 10 s. Ofertas sem resposta são reenviadas, e a sinalização espera o WebSocket voltar.

## Mapa compartilhado
Cada servidor tem um mapa: quem abre vê o mesmo lugar que os outros, os cursores de cada um e os marcadores.
- **O mapa em si não passa pelo nosso servidor.** O app desenha com o MapLibre GL (carregado só quando o mapa abre) e baixa os mapas do OpenFreeMap; a busca de endereço vai pro Nominatim (OpenStreetMap), só ao apertar Enter e no máximo uma por segundo (`app/src/renderer/lib/geocode.ts`). A CSP libera só esses dois endereços, e o worker do MapLibre é servido pelo próprio app (sem `blob:`). O "Abrir no Google Maps" abre o navegador no mesmo lugar.
- **Quem está no mapa é por conexão** (`ConnState.map`, no próprio socket): a lista de canais de todo mundo mostra quem está lá (`map.viewers`). Quem cai sem avisar continua no mapa enquanto é "fantasma"; voltando, o app confirma com `map.join` (ou sai, se fechou o mapa no meio-tempo).
- **Vista e cursor** (`map.view`, `map.cursor`) vão só pra quem está com o mapa aberto, e têm um limite próprio (300 a cada 10 s por conexão), porque arrastar manda ~12 por segundo. Quem está mexendo não é puxado pela vista dos outros; ao soltar, vale a de quem parou por último. De castigo, a pessoa vê mas não mexe no mapa dos outros.
- **A última vista** fica na memória e vai pra tabela `meta` (`map_view`) no máximo a cada 5 s, e na hora quando o último sai: quem abre depois começa nela.
- **Marcadores** ficam na tabela `map_pins` do servidor (até 200). Qualquer membro marca; apaga quem marcou ou quem pode apagar mensagens.

## Rabiscos na tela de quem compartilha
Quem assiste uma transmissão desenha por cima dela, e quem compartilha vê os rabiscos no próprio monitor (como nas calls do Slack). Só vale compartilhando o monitor inteiro.
- **Nada passa pelo servidor.** Os traços vão pelo canal de dados `ink` (negociado, id 2) da mesma RTCPeerConnection da call (`app/src/renderer/lib/peer.ts`). Quem compartilha avisa com `ink.policy` se dá pra rabiscar; quem assiste manda `ink.stroke` (pedaços de traço a cada ~33 ms) e `ink.ping` (um clique rápido). As posições vão de 0 a 1 em relação à imagem, então a resolução de cada um não importa. Quem compartilha confere tudo (`cleanInk`) e limita a 90 mensagens por segundo por pessoa.
- **A camada por cima do monitor** fica em `app/src/main/ink.ts`. No Wayland (Hyprland, KDE) é um ajudante em Python, `app/resources/ink-overlay.py` (GTK4 + gtk4-layer-shell): uma camada `overlay`, transparente e com região de entrada vazia, então não pega clique e fica por cima até de jogo em tela cheia. O Electron sozinho não cria esse tipo de janela. O ajudante lê um JSON por linha no stdin e fecha quando o stdin fecha (o app saindo ou caindo leva ele junto). No Windows e no X11 é uma janela transparente do próprio Electron, sempre por cima e sem pegar clique. O GNOME não tem layer-shell: lá aparece "não dá pra desenhar".
- **É monitor inteiro? Qual?** No Wayland o Electron marca toda captura como janela (`window:`; o PipeWire usa um capturador só pra monitor e janela), então o `displaySurface` não serve. O app lê o tamanho dos quadros da própria captura: formato igual ao de um monitor (`ink-overlay.py --list`) é monitor inteiro, ou janela em tela cheia, que dá no mesmo. Com mais de um monitor desse formato, a camada abre em cada um (o último escolhido primeiro) e pinta um quadradinho rosa de 48 px no canto; o app procura ele no canto da captura (`FrameReader` em `lib/ink.svelte.ts`) e fica no monitor onde ele apareceu. Se não aparecer em nenhum, vale o último escolhido, ou o app pergunta no painel da transmissão.
- **Quem desenha não vê o próprio traço dobrado.** A camada está no monitor transmitido, então os rabiscos entram na transmissão e voltam pra quem desenhou, atrasados. Não dá pra tirar a camada da captura (o Hyprland só sabe pintar de preto o que esconde do compartilhamento). Então quem desenha pinta o próprio traço por cima do vídeo (`InkLayer.svelte`), no mesmo lugar e do mesmo jeito que a camada de lá, um pouco mais grosso (1 px de cada lado) e durando 0,5 s a mais, e a cópia atrasada fica escondida embaixo. Pra isso funcionar, a etiqueta com o nome fica parada no começo do traço, a ponta do laser é mais fina que o traço, e o `ink.policy` leva o tamanho do monitor de lá (a grossura depende dele em telas com menos de 1080 px). O ping não tem eco (duas animações defasadas não se escondem): aparece só pelo vídeo. O e2e confere pixel a pixel que a cópia no vídeo fica toda embaixo do eco.
- **Quem compartilha decide:** "Deixar quem assiste rabiscar" no diálogo de compartilhar, no painel "Ao vivo" e em Configurações → Voz e vídeo (`settings.inkAllowed`). Desligado (ou compartilhando uma janela), o `ink.policy` vai com o motivo, e quem assiste vê o lápis apagado dizendo por quê. Apagar tudo (`ink.clear`) e desligar apagam o eco de quem desenha também.
- **No e2e** (`RESENHA_INK_DRY=1`), a camada não abre: o processo principal finge dois monitores iguais e só guarda o que chegou em `globalThis.__resenhaInk`. A tela falsa diz "janela" como no Wayland, e o teste pinta o quadradinho nela só quando a camada está no TESTE-2; depois confere as posições dos traços.

## Importar canais do Discord (por print)
- **Ler:** o app manda o print da lista de canais (PNG até 2048 px, ou JPEG se passar de 1,4 MB) pra `POST /api/import/discord`. O Worker manda pro Workers AI (`src/discord-import.ts`) e devolve `{ server, channels, categories }`, conferido por `cleanStructure` (até 50 categorias e 300 canais, nomes de 1 a 100 caracteres, só texto ou voz). Nada é guardado.
- **Modelo:** `@cf/google/gemma-4-26b-a4b-it` com `enable_thinking: false`. Num print de teste com emoji, separador "┃", gente na call e itens que não são canal, ele acertou a estrutura toda e quase todos os emojis por ~18 neurons, em ~10 s. O plano grátis dá 10 mil neurons por dia. Com o "raciocínio" ligado ele gasta o limite de texto antes de responder. Llama 4 Scout achou que as pessoas da call eram canais; Mistral Small perdeu uma categoria; Qwen 3.8 errou mais emoji por 9× o custo; Kimi não está no plano grátis.
- **Limites:** `IMPORT_LIMITER` (6 por minuto por pessoa) e 1,5 MB por print. Passando da cota diária, o Workers AI recusa e o app mostra o erro: não tem cobrança no plano grátis.
- **Criar:** a pessoa confere e edita no app (`ui/server/DiscordImport.svelte`: tipo, nome, tirar o que não quer, tirar os emojis), e o app manda `channel.import` pro Guild, que cria tudo de uma vez (precisa de gerenciar canais e respeita o limite de 500 canais). No modo "Trazer do Discord", o app cria o servidor com o nome do print e apaga as categorias e canais que todo servidor novo ganha.
- **Testes:** os testes do servidor rodam com `remoteBindings: false` e o e2e com `wrangler dev --local` (sem o Workers AI de verdade, que pediria login e internet); o e2e intercepta a leitura e devolve o que o modelo respondeu de verdade pro print de `app/test/fixtures/discord-print.png`.

## Segurança (regras do servidor)
- Token de sessão: 32 bytes aleatórios, guardado só como SHA-256. Vai no header `Authorization` (HTTP) ou na primeira mensagem do WebSocket (`auth`), nunca na URL.
- Sessões expiram após 30 dias sem uso; lista de aparelhos; derrubar um ou todos; trocar a senha derruba os outros.
- Senha: PBKDF2-SHA256 (100 mil iterações, o máximo do runtime), mínimo 8 caracteres, recusa as mais comuns.
- Limite de tentativas persistente por IP e por usuário, com espera crescente. Usuário inexistente gasta o mesmo tempo (não revela quem existe).
- Toda ação é checada no servidor (membro do servidor? tem permissão? é a própria mensagem?). O app nunca é confiável.
- O Worker é o único que fala com os DOs e põe a identidade do usuário (`X-Resenha-User`) depois de autenticar; o que vem de fora com esse header é descartado.
- Arquivos: URL assinada (HMAC) com validade; servidos com `Content-Security-Policy: sandbox` e `nosniff`.
- Mídia de perfil (avatar, banner, ícone) tem id impossível de adivinhar e cache imutável. O tipo é conferido pelos bytes. Foto parada até 512 KB; animada (GIF/WebP) e banner até 1,5 MB (uma linha do SQLite do DO aguenta 2 MB). Foto animada só entra com o quadro parado junto.
- Personalização do perfil (`server/src/style.ts`): uma coluna `style` (JSON) no Directory e na cópia dos perfis de cada Guild. Só ids da lista embutida, cores 0..0xFFFFFF e pronomes limpos; banner e quadro parado só mudam pelas rotas de imagem.

## Rotas
- `GET /api/g/<servidor>/ws` e `GET /api/home/<pessoa>/ws`: WebSockets (o Worker confere antes se o servidor/a conta existe, pra ninguém criar DO à toa).
- `/api/...` por HTTP: login, perfil, sessões, amigos, bloqueios, criar/sair/excluir servidor, convites, anexos (`/api/g/<id>/files`, `/api/c/<conversa>/files`), proxy de imagem das prévias e o painel da dona da plataforma.
- `/media/<id>`: fotos de perfil, banners e ícones (id aleatório, cache imutável). `PUT/DELETE /api/me/avatar` (foto animada vai em formulário: `image` + `still`) e `PUT/DELETE /api/me/banner`.
- `/verify`: página do Turnstile (cadastro aberto).
- Rotas da 0.5 (`/ws`, `/api/files`, `/api/register` com `name`): continuam funcionando pro app antigo até ele se atualizar.

## Limites e anti-abuso
- Até 5 mensagens a cada 5 s por pessoa, modo lento por canal, limite de reações, buscas e envios de arquivo.
- Anexos: 25 MB por arquivo, 4 GB por servidor, 1 GB por conversa e 4 GB pra plataforma inteira (o Directory soma o que cada um usa).
- Cadastro: 10 tentativas por hora por IP. Login: 5 erros por conta e 20 por IP a cada 15 min, com espera crescente.

## Migração dos dados da 0.5
O `Space` "main" vira o primeiro servidor (`renamed_classes` no wrangler: mesmo DO, mesmos dados). Na primeira vez que o Directory sobe, ele:
1. Puxa as contas, sessões e convites do "main" por RPC, mantendo os tokens válidos: ninguém precisa entrar de novo. O apelido antigo vira nome de usuário (`Duarte Zé` → `duarte_ze`) e continua servindo pra entrar.
2. Registra o "main" como servidor "Resenha", com a dona antiga e todo mundo dentro, tudo marcado como lido.
3. Pelo alarme, uma por vez, move cada conversa privada (com os arquivos) pro Conversation dela e tira do "main".

O "main" atualiza as próprias tabelas na hora: canais ganham categoria e permissões, mensagens ganham resposta, menções, reações, fixadas e índice de busca. O app 0.5 continua conectando no `/ws` e recebe só o que entende; as DMs pedem pra atualizar o app.

Se algo der errado, os DOs com SQLite têm recuperação até 30 dias atrás (point-in-time recovery).
