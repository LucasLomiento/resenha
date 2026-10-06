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

## 0.6 — Contas de verdade (D1)
- [ ] Banco global (D1) pra contas, sessões, servidores, convites, amizades
- [ ] Nome de usuário (único) + nome de exibição + foto de perfil + "sobre mim"
- [ ] Aparelhos conectados, sair de um ou de todos, expiração por inatividade
- [ ] Trocar senha (derruba os outros aparelhos), excluir conta
- [ ] Limite de tentativas de login persistente (por IP e por usuário), sem revelar se o usuário existe
- [ ] Cadastro: só convite (padrão) ou aberto com Turnstile; painel do dono da plataforma

## 0.7 — Vários servidores
- [ ] Um Durable Object por servidor; o servidor atual vira o primeiro, sem perder nada
- [ ] Criar servidor, ícone, convites com validade e limite de usos, sair, excluir, transferir
- [ ] Barra de servidores, início com amigos e mensagens privadas
- [ ] Amizades (pedido, aceitar, remover) e bloqueio
- [ ] Status: online, ausente (automático), não perturbe, invisível, status personalizado

## 0.8 — Cargos e moderação
- [ ] Cargos com cor, posição e permissões; canais privados por cargo
- [ ] Categorias e ordem dos canais
- [ ] Lista de membros agrupada por cargo
- [ ] Expulsar, banir, desbanir; mutar, ensurdecer, desconectar e mover na call
- [ ] Apelido por servidor; registro de auditoria

## 0.9 — Mensagens completas
- [ ] Markdown completo, @menções (usuário, cargo, @everyone) com notificação, #canais
- [ ] Responder, reações com emoji, fixar, buscar
- [ ] Prévia de links feita pelo servidor (o IP de quem vê não vaza pros sites)
- [ ] Não lidas persistentes, contadores de menção, configuração de notificação por servidor/canal
- [ ] Ctrl+K pra trocar de canal, ↑ pra editar a última mensagem

## 1.0 — Produção
- [ ] Modo privado (tudo via TURN, esconde o IP até dos amigos) — precisa da chave TURN
- [ ] Ligação de voz/vídeo direto na mensagem privada
- [ ] Exportar meus dados (LGPD), política de privacidade e termos de uso
- [ ] Revisão de segurança independente, documentação de operação (backup, logs, limites)
