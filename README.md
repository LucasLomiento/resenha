# Resenha

> **Só quer instalar e usar?** Baixe em [Releases](https://github.com/LucasLomiento/resenha/releases/latest) e siga o [INSTALAR.md](INSTALAR.md).

Um app no estilo do Discord: vários servidores com canais, cargos e moderação, mensagens privadas, amigos, chat com imagens e arquivos, call de voz, câmera e compartilhamento de tela até 1440p a 60 fps com áudio. O áudio da tela **não leva junto a voz da call**. Voz e tela vão direto entre os PCs (P2P), e o Cloudflare só cuida das contas, do chat e de apresentar as pessoas umas às outras.

## Como funciona

```
 app (Electron, Linux/Windows)                 Cloudflare (Worker + Durable Objects com SQLite)
 ├─ HTTP (login, perfil, anexos) ─── HTTPS ─▶  Worker ─▶ Directory: contas, sessões, servidores, convites, amigos
 ├─ 1 WebSocket por servidor ──────── WSS ──▶  Guild (um por servidor): canais, cargos, mensagens, voz
 ├─ 1 WebSocket pessoal ───────────── WSS ──▶  Home (um por pessoa): DMs, amigos, status
 │                                              └─▶ Conversation (uma por DM): mensagens e chamada
 └─ voz, câmera e tela ── WebRTC P2P direto ──▶ outros PCs
                          (TURN do Cloudflare só se a rede bloquear o direto)
```

Os detalhes (e as regras de segurança do servidor) estão em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

- **server/**: Worker e quatro Durable Objects, todos criados na América do Sul. Os WebSockets usam hibernação: parado, não gasta nada.
- **Permissões** no modelo do Discord: cargos com hierarquia, exceções por canal e por categoria, castigo, expulsão, banimento e registro de auditoria. Tudo é conferido no servidor (o cálculo fica em `shared/permissions.ts`).
- **Mensagens**: resposta, menções (pessoa, cargo, @everyone), reações, fixadas, busca sem acento (FTS5), contagem de não lidas e menções, e prévia de link buscada pelo servidor (quem lê nunca acessa o site do link).
- **Perfil personalizado** (o "Nitro" de graça): banner e foto que podem ser animados, tema do cartão em duas cores, pronomes, moldura do avatar, efeito no cartão e nome com fonte e efeito. Molduras, efeitos e fontes vêm embutidos no app; o servidor guarda só os ids (`server/src/style.ts`).
- **Anexos** (`server/src/files.ts`): ficam no SQLite do servidor/conversa, em pedaços de 1 MB, até 25 MB por arquivo, com teto de espaço pra plataforma inteira.
- **app/**: Electron + Svelte 5. Cada pessoa da call tem uma `RTCPeerConnection` própria (`src/renderer/lib/peer.ts`, com "perfect negotiation"); a mesma call serve pro canal de voz e pra chamada privada. A tela só é enviada pra quem clica em **Assistir**.
- **shared/**: os tipos das mensagens trocadas entre o app e o servidor, e o cálculo de permissões.

### Áudio da tela sem a voz da call

- **Linux**: o [venmic](https://github.com/Vencord/venmic) (o mesmo do Vesktop) cria no PipeWire um microfone virtual, `vencord-screen-share`, com o som de todos os apps. Fica de fora o processo "Audio Service" do Chromium, que é por onde sai **todo** o som do Resenha. O código está em `app/src/main/screen-audio-linux.ts`.
- **Windows 10 22H2+ e 11**: o processo principal entrega `loopbackWithoutChrome`, que é o som do sistema menos o processo do app (WASAPI process loopback). Em Windows mais antigo cai pro loopback comum, e o app avisa que a voz da call vai junto.

### Atraso

- P2P direto. A sinalização fica num Durable Object na América do Sul.
- Captura a 60 fps com `contentHint = motion` e `degradationPreference = maintain-framerate`: com a rede apertada, cai a resolução e os 60 fps se mantêm.
- Presets de bitrate: 720p a 4 Mbps, 1080p a 8 Mbps, 1440p a 12 Mbps.
- O áudio da tela vai em Opus estéreo a 128 kbps.
- O player mostra estatísticas: resolução, fps, bitrate, codec, ping e buffer.

No teste local (duas instâncias no mesmo PC), o atraso de ponta a ponta medido quadro a quadro ficou em torno de **15–25 ms**. Entre casas, some a isso o ping entre vocês.

## Rodar local

```bash
npm install                    # instala tudo e baixa o Electron
npm run dev:server             # Worker em http://127.0.0.1:8787 (crie server/.dev.vars, abaixo)
VITE_DEFAULT_SERVER=http://127.0.0.1:8787 npm run dev:app   # app com hot reload, no servidor local
```

`server/.dev.vars`:

```
FILE_SECRET=qualquer-coisa-local
```

O servidor do app vem do build: `VITE_DEFAULT_SERVER`, e sem ela vale o de produção. A primeira conta criada vira a dona da plataforma (painel de administração). As outras entram com convite de algum servidor, ou pelo cadastro aberto, se ele estiver ligado. Pra abrir uma segunda instância com outra conta no mesmo PC: `RESENHA_PROFILE=b npm -w app run start`.

## Colocar no ar (Cloudflare)

Já está no ar em **https://resenha.lucaslomiento.workers.dev**. Pra refazer do zero em outra conta:

```bash
cd server
npx wrangler login                                   # abre o navegador
npx wrangler deploy                                  # mostra a URL *.workers.dev
openssl rand -base64 32 | tr -d '\n' | npx wrangler secret put FILE_SECRET
```

**TURN (opcional).** É o relay de reserva pra quando a rede de alguém bloqueia a conexão direta, o que é comum com CGNAT. Pra ativar:

1. No painel do Cloudflare, vá em **Realtime → TURN Server** e crie uma chave.
2. Rode:

   ```bash
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```

Sem essas duas variáveis o app usa só STUN e tenta sempre a conexão direta. O TURN tem 1000 GB grátis por mês, e como aqui ele só entra quando o direto falha, na prática fica de graça.

**Cadastro aberto com anti-robô (opcional).** Por padrão só entra quem tem convite. Pra deixar qualquer pessoa criar conta:

1. No painel do Cloudflare, vá em **Turnstile**, crie um widget e coloque o domínio do Worker.
2. Ponha a chave do site em `TURNSTILE_SITE_KEY` (no `wrangler.jsonc`) e a secreta com `npx wrangler secret put TURNSTILE_SECRET`.
3. No app, a dona da plataforma liga em Configurações → Plataforma.

## Lançar uma versão nova

Quem gera os pacotes é o GitHub Actions (`.github/workflows/release.yml`), e os apps instalados se atualizam sozinhos a partir das Releases (electron-updater):

1. Suba a versão em `app/package.json` e escreva o `RELEASE_NOTES.md`.
2. Faça o commit e rode `git tag vX.Y.Z && git push origin main vX.Y.Z`.
3. O Actions gera o `.pacman`, o AppImage, o instalador do Windows e o `.zip`, junta tudo numa release e publica.

Formatos que se atualizam pelo app:
- **Instalador do Windows (NSIS):** o electron-updater instala sozinho.
- **AppImage:** o electron-updater instala sozinho.
- **`.pacman`:** a gente instala (`app/src/main/updater.ts`). Primeiro tenta o `pkexec`, que funciona quando há agente do polkit (KDE). Sem agente, abre um terminal com `sudo`.

O `.zip` do Windows não se atualiza.

Pra gerar localmente:

```bash
cd app
VITE_DEFAULT_SERVER=https://resenha.lucaslomiento.workers.dev npm run dist:arch      # .pacman
VITE_DEFAULT_SERVER=... npm run dist:appimage                                        # AppImage
VITE_DEFAULT_SERVER=... npm run dist:win:zip                                         # Windows .zip (o instalador precisa do wine no Linux)
```

## Atalhos globais e linha de comando

Os atalhos de Configurações → Atalhos são registrados no sistema: direto no Windows e no X11, e pelo portal `GlobalShortcuts` no Wayland (KDE, GNOME).

No **Hyprland** o portal não usa as teclas escolhidas pelo app, então lá o jeito é um bind no seu config chamando o app:

```
resenha --action=toggle-mute      # também: toggle-deafen, toggle-share, leave-call, show-window
```

Com o Resenha aberto, esse comando só manda a ação pra janela que já está rodando.

## Testes

```bash
npm test                       # servidor: contas, servidores, permissões, moderação, mensagens, DMs, chamadas, migração da 0.5
npm -w app run typecheck
npm -w app run test:ui         # formatação das mensagens
npm -w app run test:mic        # processador do microfone (RNNoise + limiar), no Node, sem áudio
npm -w app run e2e             # duas instâncias escondidas do app contra o servidor local
```

O e2e faz o fluxo inteiro: cadastro, convite, chat, anexo, call P2P, indicador de fala, transmissão de tela e medição do atraso. O microfone e a tela são falsos: um oscilador e um canvas com o horário codificado em pixels. Por padrão ele roda em 720p e **sem** o áudio da tela. Duas variáveis ligam o resto:

- `RESENHA_E2E_AUDIO=1`: liga o venmic e confere no grafo do PipeWire que o áudio da tela pega os outros apps, mas não o próprio Resenha. **Atenção:** isso religa as saídas dos apps que estão tocando (Spotify, Discord…) e pode fazer o som do PC engasgar enquanto roda.
- `RESENHA_E2E_FULL=1`: transmite em 1440p, com duas codificações pesadas na CPU.
- `RESENHA_SHOTS=pasta`: salva capturas da interface.

## Limites conhecidos

- **P2P**: cada pessoa assistindo a sua tela custa mais ~12 Mbps de upload (em 1440p) e mais uma codificação na CPU. Pra 1–3 pessoas assistindo está ótimo. Pra muito mais, o caminho seria o SFU do Cloudflare Realtime.
- **Linux**: o WebRTC do Chromium não usa o NVENC da NVIDIA, então a codificação é por CPU. Se pesar, troque o codec pra VP8 ou H264 em Configurações → Tela.
- **Windows**: o áudio da tela sem a voz da call precisa do Windows 10 22H2 ou mais novo.
