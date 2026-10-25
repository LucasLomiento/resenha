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

| Segredo | Pra quê | Como guardar | Obrigatório |
|---|---|---|---|
| `FILE_SECRET` | Assina os links de arquivo e embaralha IPs | O comando abaixo | Sim |
| `TURNSTILE_SECRET` | Anti-robô do cadastro aberto (junto com `TURNSTILE_SITE_KEY` no `wrangler.jsonc`) | `npx wrangler secret put TURNSTILE_SECRET` | Não |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | TURN do Cloudflare, só nas salas marcadas "pelo Cloudflare" | `bash server/scripts/realtime-keys.sh` | Não |
| `REALTIME_APP_ID`, `REALTIME_APP_SECRET` | SFU do Cloudflare: a tela com 2+ assistindo, só nas salas pelo Cloudflare | `bash server/scripts/realtime-keys.sh` | Não |
| `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` | Conferir de hora em hora o que o Cloudflare mediu de SFU e TURN (a trava dos 850 GB). Sem eles, a trava conta só o que os apps dizem | `bash server/scripts/realtime-keys.sh` | Não |
| `FCM_SERVICE_ACCOUNT` | Push do celular: a conta de serviço do Firebase (projeto `resenha-5e289`). Sem ela, o servidor não manda push | `bash server/scripts/firebase-key.sh <arquivo .json>` | Não |

```bash
openssl rand -base64 32 | tr -d '\n' | npx wrangler secret put FILE_SECRET
```

Os scripts leem os valores sem mostrar na tela e passam direto pro `wrangler` (detalhes em "Mídia pelo Cloudflare" e "Push do celular", abaixo). Os testes do servidor apagam as chaves do Realtime, das análises e do Firebase (`server/vitest.config.ts`), então eles nunca falam com o Cloudflare ou com o Google de verdade.

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

O painel da dona da plataforma (no app: Configurações → Plataforma) mostra contas, servidores, convites ativos, o espaço de anexos usado, a mídia pelo Cloudflare do mês e os pedidos do dia (abaixo).

### Pedidos do dia (a cota que derruba tudo)

No plano grátis, passou de **100 mil pedidos aos Durable Objects num dia**, todos eles dão erro até a meia-noite UTC (21h em Brasília): login, chat, calls, avisos, tudo. Conta como pedido: abrir WebSocket, cada RPC entre os objetos (uma mensagem privada passa por três), cada alarme e **cada mensagem de WebSocket recebida, inteira**. Em 25/10/2026 o aviso de 90% e o corte bateram com essa conta, não com o "20 mensagens = 1 pedido" da cobrança do plano pago. O e-mail do Cloudflare chega em 50, 75, 90 e 100%, e o corte veio uns 15 min depois de passar de 100 mil.

Com as chaves das análises (`CF_ACCOUNT_ID` e `CF_ANALYTICS_TOKEN`, as mesmas da mídia), o Directory mede o dia de 10 em 10 min (`server/src/usage.ts`; 144 alarmes por dia) e a Plataforma mostra:

- **Pedidos ao Cloudflare hoje**: quanto já foi de 100 mil, a hora da medição, quando zera e, se o ritmo dos últimos 10 min passa do limite antes da meia-noite, a hora em que acaba. As análises chegam com uns minutos de atraso.
- **Quem mais gastou hoje**: os objetos do topo com o nome. A conexão pessoal de uma conta (o Home dela), uma conversa privada (as duas contas), um servidor ou "Contas e cadastro" (o Directory). O servidor calcula o id de cada um com `idFromName`, sem acordar ninguém e sem ler mensagem. Conversa só se identifica entre amigos, onde já teve anexo, ou quando uma das duas contas também está no topo; o resto aparece como "Não identificado".
- **Barrados pelo servidor**: os apps que os freios do servidor seguraram (chamada privada em laço etc.), com a conta e a hora.

O que o servidor faz sozinho:

| Quando | O quê |
|---|---|
| 60% antes das 21h UTC, ou o ritmo estourando antes da meia-noite (com 20% já gasto) | Avisa o dono uma vez no dia: aviso na tela e do sistema nos apps abertos e push em todo celular dele (mesmo no "Não perturbe") |
| 80% | **Modo econômico**: o cadastro aberto fecha até a cota zerar (convite continua valendo; quem tenta sem convite lê "O cadastro está pausado por algumas horas"). A escolha do dono não muda e volta a valer sozinha no dia seguinte. Novo aviso pro dono |

Ninguém que já está usando é derrubado: o modo econômico só segura gente nova.

**Num pico**, pela ordem:
1. Abra Configurações → Plataforma e veja quem está no topo. Um par de contas com a conversa entre elas no topo é chamada privada em laço; uma conta sozinha com muito mais que as outras é um app com problema.
2. Fale com a pessoa (fechar o app resolve na hora). Se não der, **Suspender** em Contas tira ela de todos os aparelhos: os pedidos dela param na hora.
3. Os números de agora, por fora do app (só contagens, nada do conteúdo): a consulta `durableObjectsInvocationsAdaptiveGroups` do GraphQL (ver o item das análises no `CLAUDE.md`), por `objectId` e por minuto.
4. Se estourar mesmo assim, só o plano pago (US$ 5/mês, sem teto diário) devolve o serviço antes da meia-noite UTC.

Sem as chaves das análises, nada disso aparece (nem o cartão na Plataforma). O e2e sobe o servidor com `CF_ANALYTICS_TOKEN` vazio: o servidor local não lê as análises da conta de verdade.

## Limites do plano grátis (e o que o Resenha faz)

| Limite | Valor | No Resenha |
|---|---|---|
| CPU por pedido no Worker | 10 ms | Senha (PBKDF2) roda dentro do Durable Object, que tem mais folga |
| Armazenamento dos Durable Objects | 5 GB na conta | Anexos param em 4 GB (2 GB por servidor, 1 GB por conversa, 500 MB por pessoa por dia) |
| Pedidos aos Durable Objects | 100 mil por dia | WebSocket com hibernação: conexão parada não conta. Passou disso, tudo para até a meia-noite UTC: o servidor mede, avisa o dono e fecha o cadastro aberto antes (ver "Pedidos do dia") |
| Linhas escritas no SQLite | 100 mil por dia | Limites de mensagens (5 a cada 5 s), reações, edições e leitura agrupada |
| Mídia pelo Cloudflare Realtime (SFU + TURN) | 1.000 GB por mês | Só nas salas marcadas "pelo Cloudflare": voz, câmera e tela pelo TURN, e a tela com 2+ assistindo pelo SFU. Sala direta e chamada privada são P2P e não gastam nada. Os apps contam o que passa, o servidor confere com o que o Cloudflare mediu (de hora em hora) e para de oferecer os dois em 850 GB; aí essas salas vão direto (P2P), avisando, até o mês virar. O dono vê o total em Configurações → Plataforma |

Se o grupo crescer muito, o plano pago (US$ 5/mês) multiplica tudo isso; nada no código precisa mudar.

## Mídia pelo Cloudflare (SFU e TURN)

Só a sala de voz que o dono marcou "pelo Cloudflare" usa o Realtime: voz, câmera e a cópia direta da tela passam pelo TURN (ninguém da sala vê o IP de ninguém), e a tela com 2+ assistindo vai uma vez só pro SFU. Sala direta e chamada privada são P2P em tudo (desde a 1.12.1).

As chaves saem do painel do Cloudflare (o login do wrangler não tem permissão pro Realtime):
1. **Realtime → Serverless SFU → Create**: dá o App ID e o App Token.
2. **Realtime → TURN Server → Create**: dá o Key ID e o API Token.
3. **My Profile → API Tokens → Create Token → Custom token**, com a permissão *Account → Account Analytics → Read*: o servidor confere de hora em hora quanto o Cloudflare mediu (SFU e TURN) e usa o maior entre isso e a conta dos apps.
4. `bash server/scripts/realtime-keys.sh`: pede os valores sem mostrar na tela, confere cada um no Cloudflare e guarda como secrets do Worker (`REALTIME_APP_ID`, `REALTIME_APP_SECRET`, `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, `CF_ANALYTICS_TOKEN` e `CF_ACCOUNT_ID`, que ele tira do `wrangler whoami`). As do SFU e das análises também vão pro `server/.dev.vars`, pro e2e com `RESENHA_E2E_SFU=1` (os testes do servidor apagam essas no `vitest.config.ts`).

A conta tem cartão (o Realtime pede pra ativar): o que passar de 1.000 GB no mês seria cobrado (US$ 0,05/GB). Por isso a trava em 850 GB olha as duas contagens. Vale também um alerta de gasto em *Manage Account → Billing → Billable Usage → Create budget alert* (US$ 1, por e-mail; ele só avisa, não corta).

Sem as chaves, tudo funciona, só que P2P: a sala pelo Cloudflare vai direto, e o app avisa.

## Push do celular (Firebase)

O app de Android recebe os avisos pelo Firebase Cloud Messaging, projeto `resenha-5e289` (o `mobile/android/app/google-services.json` está no repositório; não é segredo). O servidor manda com a conta de serviço desse projeto:

1. No console do Firebase: **Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Baixa um `.json`.
2. `bash server/scripts/firebase-key.sh <arquivo .json>`: confere o arquivo e guarda como o secret `FCM_SERVICE_ACCOUNT`, sem mostrar o conteúdo.
3. Apague o `.json` (ou guarde fora do repositório): com ele, dá pra mandar push pra todos os celulares do Resenha. O Cloudflare não devolve o secret; se precisar de novo, gere outra chave no console e revogue a antiga.

Sem o secret, o servidor não manda push (o resto funciona igual). Com a chave também no `server/.dev.vars`, o `npm -w app run test:android` manda um push de verdade pro emulador.

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
