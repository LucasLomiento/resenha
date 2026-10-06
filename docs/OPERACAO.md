# Operação do servidor

Como colocar no ar, acompanhar e, se precisar, voltar atrás. Tudo roda numa conta do Cloudflare (plano grátis).

## Colocar no ar

```bash
cd server
npx wrangler login                     # uma vez
npm test                               # 100% verde antes de qualquer deploy
npx wrangler deploy
```

Segredos (uma vez por conta):

| Segredo | Pra quê | Obrigatório |
|---|---|---|
| `FILE_SECRET` | Assina os links de arquivo e embaralha IPs | Sim |
| `TURNSTILE_SECRET` | Anti-robô do cadastro aberto (junto com `TURNSTILE_SITE_KEY` no `wrangler.jsonc`) | Não |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | Relay pra quando a conexão direta falha | Não |

```bash
openssl rand -base64 32 | tr -d '\n' | npx wrangler secret put FILE_SECRET
```

**Cuidado:** trocar o `FILE_SECRET` invalida todos os links de arquivo já enviados (o app pega links novos ao recarregar o chat) e zera os limites de tentativa por IP.

## Migrações dos Durable Objects

As classes e as migrações ficam no `wrangler.jsonc`. Regras:

- Migração é aplicada no deploy, de uma vez, e **não volta** com `wrangler rollback`. Teste antes.
- Nunca apague uma migração antiga da lista; só acrescente no fim, com uma `tag` nova.
- Renomear classe (`renamed_classes`) leva junto todos os dados; criar classe nova (`new_sqlite_classes`) começa vazia.

As tabelas de dentro de cada Durable Object se atualizam sozinhas quando ele sobe (`CREATE TABLE IF NOT EXISTS` e `ALTER TABLE` conferindo as colunas), então mudar esquema não precisa de migração no `wrangler.jsonc`.

## Acompanhar

```bash
npx wrangler tail resenha              # logs ao vivo (erros aparecem como "erro tratando …")
```

No painel do Cloudflare: Workers → resenha → Observability, com os pedidos, erros e uso de CPU.

O painel da dona da plataforma (no app: Configurações → Plataforma) mostra contas, servidores e o espaço de anexos usado.

## Limites do plano grátis (e o que o Resenha faz)

| Limite | Valor | No Resenha |
|---|---|---|
| CPU por pedido no Worker | 10 ms | Senha (PBKDF2) roda dentro do Durable Object, que tem mais folga |
| Armazenamento dos Durable Objects | 5 GB na conta | Anexos param em 4 GB (2 GB por servidor, 1 GB por conversa, 500 MB por pessoa por dia) |
| Pedidos aos Durable Objects | 100 mil por dia | WebSocket com hibernação: conexão parada não conta |
| Linhas escritas no SQLite | 100 mil por dia | Limites de mensagens (5 a cada 5 s), reações, edições e leitura agrupada |

Se o grupo crescer muito, o plano pago (US$ 5/mês) multiplica tudo isso; nada no código precisa mudar.

## Voltar no tempo (backup)

Os Durable Objects com SQLite guardam o histórico dos últimos 30 dias (point-in-time recovery). Pra voltar um servidor (ou o cadastro central) a um momento:

1. Ache o ponto: um horário (`ctx.storage.getBookmarkForTime(Date.parse('2026-10-06T12:00:00-03:00'))`) ou um marcador salvo.
   O servidor "main" guardou o marcador de antes da migração da 0.5 na tabela `meta`, chave `pre_v2_bookmark`.
2. Faça um deploy temporário com um método no Durable Object em questão que rode:

   ```ts
   await this.ctx.storage.onNextSessionRestoreBookmark(bookmark)
   this.ctx.abort() // reinicia já no ponto escolhido
   ```

   e chame esse método uma vez (por exemplo, por um `wrangler dev --remote` ou uma rota temporária protegida).
3. Tire o código temporário e faça o deploy normal de novo.

Restaurar volta **tudo** daquele Durable Object pro momento escolhido: o que aconteceu depois some.

## Contas e acesso

- A primeira conta criada num servidor novo vira a dona da plataforma. Crie a sua antes de divulgar o endereço.
- Cadastro aberto só funciona com o Turnstile configurado; sem ele, o servidor recusa e o padrão continua "só com convite".
- Pra suspender alguém da plataforma: Configurações → Plataforma → procurar → Suspender (derruba as sessões na hora).
