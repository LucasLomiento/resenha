# Roteiro do Resenha até a 1.0

Objetivo: um app no nível do Discord, seguro pra quem hospeda, pra quem usa e pro servidor, pronto pra ser aberto ao público ou vendido.

Decisões (05/10/2026):
- **Vários servidores** (guilds), como o Discord: conta única, amigos, mensagens privadas fora dos servidores.
- **Cadastro aberto com anti-robô** (Cloudflare Turnstile) como opção do dono. O padrão é só por convite.

## 0.5 — Segurança imediata
- [x] Token da sessão sai da URL do WebSocket (ia parar nos logs do Cloudflare)
- [x] Áudio da tela: Discord, Vesktop e outros apps de voz ficam de fora por padrão; dá pra escolher os apps
- [x] Opção de esconder o texto das mensagens nas notificações
- [x] CSP restrita ao servidor do app; IPC só aceita a própria janela

## 1.0 — Tudo junto numa versão só

As etapas 0.6 a 0.9 saíram juntas na 1.0 (uma atualização em vez de quatro).

### Contas
- [x] Cadastro central (um Durable Object, não D1: o hash da senha estoura os 10 ms de CPU de um Worker no plano grátis) pra contas, sessões, servidores, convites, amizades
- [x] Nome de usuário (único) + nome de exibição + foto de perfil + "sobre mim" + cor do perfil
- [x] Aparelhos conectados, sair de um ou de todos, expiração por inatividade
- [x] Trocar senha (derruba os outros aparelhos), excluir conta
- [x] Limite de tentativas persistente (por IP e por conta), sem revelar se o usuário existe
- [x] Cadastro: só convite (padrão) ou aberto com Turnstile; painel do dono da plataforma

### Vários servidores
- [x] Um Durable Object por servidor; o grupo atual vira o primeiro, sem perder nada (nem a sessão de ninguém)
- [x] Criar servidor, ícone, convites com validade e limite de usos, sair, excluir, transferir
- [x] Trilho de servidores, início com amigos e mensagens privadas
- [x] Amizades (pedido, aceitar, remover) e bloqueio
- [x] Status: online, ausente (automático), não perturbe, invisível, status personalizado

### Cargos e moderação
- [x] Cargos com cor, posição e permissões; canais privados por cargo (permissões próprias de cada canal, sincronizadas com a categoria)
- [x] Categorias e ordem dos canais (arrastando na lista, ou mudando a categoria nas configurações do canal)
- [x] Lista de membros agrupada por cargo
- [x] Expulsar, banir, desbanir, castigar; mutar, ensurdecer, desconectar e mover na call
- [x] Apelido por servidor; registro de auditoria

### Mensagens completas
- [x] Formatação no estilo do Discord, @menções (pessoa, cargo, @everyone) com notificação, #canais
- [x] Responder, reações com emoji, fixar, buscar (sem acento)
- [x] Prévia de links feita pelo servidor (o IP de quem vê não vaza pros sites)
- [x] Não lidas persistentes, contadores de menção, notificação por servidor/canal
- [x] Ctrl+K pra trocar de canal, ↑ pra editar a última mensagem

### Produção
- [x] Ligação de voz/vídeo direto na mensagem privada
- [x] Exportar meus dados (LGPD), política de privacidade e termos de uso
- [x] Revisão de segurança independente (15 problemas achados e corrigidos, com teste pra cada um)
- [x] Convite por link (`/i/<código>` abre o app pelo `resenha://`)
- [x] Documentação de operação: deploy, backup, logs e limites do plano grátis ([OPERACAO.md](OPERACAO.md))

## Depois da 1.0
- [ ] Modo privado (tudo via TURN, esconde o IP até dos amigos): precisa da chave TURN
- [ ] Arrastar servidores no trilho pra reordenar
- [ ] Emojis próprios de cada servidor
