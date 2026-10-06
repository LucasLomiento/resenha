# Arquitetura (a partir da 0.6)

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

## Migração dos dados atuais (0.5 → 0.6)
O `Space` "main" de hoje vira o primeiro servidor. Na primeira vez que o Directory sobe, ele puxa as contas, sessões e convites do `Space` (por RPC), mantendo os tokens válidos: ninguém precisa entrar de novo. Se algo der errado, os DOs com SQLite têm recuperação até 30 dias atrás (point-in-time recovery).
