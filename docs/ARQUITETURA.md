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

## Segurança (regras do servidor)
- Token de sessão: 32 bytes aleatórios, guardado só como SHA-256. Vai no header `Authorization` (HTTP) ou na primeira mensagem do WebSocket (`auth`), nunca na URL.
- Sessões expiram após 30 dias sem uso; lista de aparelhos; derrubar um ou todos; trocar a senha derruba os outros.
- Senha: PBKDF2-SHA256 (100 mil iterações, o máximo do runtime), mínimo 8 caracteres, recusa as mais comuns.
- Limite de tentativas persistente por IP e por usuário, com espera crescente. Usuário inexistente gasta o mesmo tempo (não revela quem existe).
- Toda ação é checada no servidor (membro do servidor? tem permissão? é a própria mensagem?). O app nunca é confiável.
- O Worker é o único que fala com os DOs e põe a identidade do usuário (`X-Resenha-User`) depois de autenticar; o que vem de fora com esse header é descartado.
- Arquivos: URL assinada (HMAC) com validade; servidos com `Content-Security-Policy: sandbox` e `nosniff`.
- Mídia de perfil (avatar, ícone) tem id impossível de adivinhar e cache imutável.

## Rotas
- `GET /api/g/<servidor>/ws` e `GET /api/home/<pessoa>/ws`: WebSockets (o Worker confere antes se o servidor/a conta existe, pra ninguém criar DO à toa).
- `/api/...` por HTTP: login, perfil, sessões, amigos, bloqueios, criar/sair/excluir servidor, convites, anexos (`/api/g/<id>/files`, `/api/c/<conversa>/files`), proxy de imagem das prévias e o painel da dona da plataforma.
- `/media/<id>`: fotos de perfil e ícones (id aleatório, cache imutável).
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
