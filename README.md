# Resenha

Um "Discord" pequeno pro grupo: chat de texto com imagens e arquivos, call de voz e compartilhamento de tela até 1440p a 60 fps com áudio. O áudio da tela **não leva junto a voz da call**. Voz e tela vão direto entre os PCs (P2P), e o Cloudflare só cuida do login, do chat e de apresentar as pessoas umas às outras.

## Como funciona

```
 app (Electron, Linux/Windows)              Cloudflare
 ├─ chat, presença, sinalização ── WSS ──▶  Worker + 1 Durable Object (SQLite)
 ├─ anexos ─────────────────────── HTTPS ─▶  R2 (URLs assinadas)
 └─ voz e tela ── WebRTC P2P direto ──▶ outros PCs
                  (TURN do Cloudflare só se a rede bloquear o direto)
```

- **server/**: Worker com um único Durable Object (`Space`) criado na América do Sul. Ele guarda contas, sessões, convites, canais e mensagens no SQLite embutido, e segura os WebSockets com hibernação, então fica parado sem gastar nada quando ninguém está usando.
- **app/**: Electron + Svelte. Cada pessoa da call tem uma `RTCPeerConnection` própria (`src/renderer/lib/peer.ts`, usando "perfect negotiation"). A tela só é enviada pra quem clica em **Assistir**.
- **shared/protocol.ts**: os tipos das mensagens trocadas entre o app e o servidor.

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
npm run dev:app                # app com hot reload
```

`server/.dev.vars`:

```
FILE_SECRET=qualquer-coisa-local
```

No login, use `http://127.0.0.1:8787` como servidor. A primeira conta criada vira a do admin. Pra abrir uma segunda instância com outra conta no mesmo PC: `RESENHA_PROFILE=b npm -w app run start`.

## Colocar no ar (Cloudflare)

```bash
cd server
npx wrangler login                                   # abre o navegador
npx wrangler r2 bucket create resenha-files
openssl rand -base64 32 | npx wrangler secret put FILE_SECRET
npx wrangler deploy                                  # mostra a URL *.workers.dev
```

**TURN (recomendado).** É o relay de reserva pra quando a rede de alguém bloqueia a conexão direta, o que é comum com CGNAT. Pra ativar:

1. No painel do Cloudflare, vá em **Realtime → TURN Server** e crie uma chave.
2. Rode:

   ```bash
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```

Sem essas duas variáveis o app usa só STUN e tenta sempre a conexão direta. O TURN e o SFU dividem 1000 GB grátis por mês. Como aqui o TURN só entra quando o direto falha, na prática fica de graça.

## Gerar o app

```bash
cd app
VITE_DEFAULT_SERVER=https://resenha.SEU-SUBDOMINIO.workers.dev npm run dist:arch     # .pacman (Arch/Omarchy)
VITE_DEFAULT_SERVER=... npm run dist:appimage                                        # AppImage (outras distros)
VITE_DEFAULT_SERVER=... npm run dist:win:zip                                         # Windows: zip, extrair e abrir Resenha.exe
VITE_DEFAULT_SERVER=... npm run dist:win                                             # Windows: instalador NSIS (no Linux precisa do wine)
```

`VITE_DEFAULT_SERVER` só preenche o campo de servidor na tela de login.

## Testes

```bash
npm test                       # servidor: contas, convites, chat, histórico, anexos, sinalização, hibernação
npm -w app run typecheck
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
