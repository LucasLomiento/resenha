# Política de privacidade

Esta política vale para quem usa um servidor do Resenha. Quem cuida do servidor (o "dono da instância") é quem responde pelos dados guardados nele. O Resenha não tem anúncios, não vende dados e não usa ferramentas de rastreamento ou de análise de comportamento.

## O que fica guardado no servidor

| Dado | Por quê | Até quando |
|---|---|---|
| Nome de usuário, nome de exibição, foto, banner, "sobre mim", pronomes, cor e personalização do perfil | Para os outros te reconhecerem | Até você mudar ou excluir a conta |
| Senha | Para você entrar. Fica só um resumo irreversível (PBKDF2-SHA256, 100 mil rodadas, com sal), nunca a senha | Até você trocar a senha ou excluir a conta |
| Sessões (aparelho, país, quando entrou e quando usou pela última vez) | Para você ver e derrubar os aparelhos conectados | 30 dias sem uso, ou até você sair |
| Status escolhido (online, ausente, não perturbe, invisível) e o texto do status | Para os amigos e os servidores saberem se você está por aí | Até você mudar |
| Código do celular para os avisos (o token do Firebase), com o idioma e a opção "Mostrar o texto da mensagem" | Para mandar os avisos pro seu celular (veja "Avisos no celular") | Até você sair da conta, encerrar aquela sessão, a sessão vencer, ou o Firebase dizer que o código não vale mais |
| Mensagens, reações e arquivos enviados (inclusive mensagens de voz) | Para a conversa existir | Até quem escreveu apagar, um moderador apagar, ou o servidor/canal ser excluído |
| Servidores de que você participa, cargos, apelidos | Para o servidor funcionar | Até você sair ou ser removido |
| Até onde você leu cada canal, as menções que faltam ler e como quer ser avisado em cada servidor | Para as não lidas e os avisos | Até você sair do servidor |
| Amizades, pedidos de amizade e bloqueios | Para a lista de amigos e para proteger você | Até você desfazer |
| Convites (servidor, quem criou, validade e quantos já usaram) | Para o link funcionar | Até o convite vencer ou acabarem os usos |
| Banimentos de um servidor (quem, por quem e o motivo) | Para quem foi banido não voltar | Até um moderador desbanir |
| Registro de moderação (quem expulsou, baniu, apagou mensagem de alguém…) | Para os administradores do servidor saberem o que aconteceu | 90 dias |
| Marcadores do mapa do servidor (lugar, nome, cor, quem marcou) e o último lugar que o mapa mostrou | Para todo mundo do servidor ver | Até quem marcou ou um moderador apagar, ou o servidor ser excluído |

**O Resenha não guarda o seu IP.** Para limitar tentativas de senha, o servidor guarda só um código embaralhado do IP (HMAC), que não permite descobrir o IP de volta, e apaga esses registros em até dois dias. A Cloudflare também mantém por poucos dias os registros técnicos dos pedidos ao servidor (o que foi pedido, quando e os erros), que servem só pra achar problemas.

## O que não passa pelo servidor

- **Voz, câmera e compartilhamento de tela** vão direto entre os aparelhos (P2P), criptografados (DTLS-SRTP). O servidor só ajuda os dois lados a se encontrarem. Vale para as salas de voz e para as chamadas privadas, por mais gente que assista a sua tela. Por ser direto, quem está na mesma call vê o seu endereço IP (é assim que a ligação direta funciona). Se isso for um problema, não entre em call com quem você não conhece.
- **Numa sala que o dono marcou como "pelo Cloudflare"** (nuvem ao lado do nome), voz, câmera e tela passam pelo retransmissor (TURN) da Cloudflare, ainda criptografadas: o retransmissor não ouve nem vê, e ninguém da sala fica sabendo o seu IP. Nessa sala, quando duas ou mais pessoas assistem a sua tela, ela vai uma vez só pro servidor de mídia da Cloudflare (SFU), que repassa pra cada uma. O caminho continua criptografado, mas o SFU, como todo servidor desse tipo, abre a imagem e o som pra repassar. Nada é gravado. Fora dessas salas, o app nem recebe a credencial do retransmissor. Se a Cloudflare não estiver disponível (por exemplo, com a cota do mês no fim), a call dessa sala vai direto e o app avisa.
- **Prévias de link** são buscadas pelo servidor, e as imagens delas passam por ele. Assim o site do link nunca vê o IP de quem está lendo a conversa.
- **O mapa** (de cada servidor) é baixado direto do [OpenFreeMap](https://openfreemap.org), e a busca de endereço vai direto pro [Nominatim](https://nominatim.org) (OpenStreetMap). Como em qualquer site, esses serviços veem o seu IP e, na busca, o que você procurou. Só quando você abre o mapa ou busca algo. Onde você está olhando no mapa e o seu cursor vão só pra quem está com o mapa do mesmo servidor aberto, e não ficam guardados (a não ser o último lugar que o mapa mostrou). **O Street View** é o do Google, incorporado: quando você abre, o Google vê o seu IP e o lugar que você está vendo, como em qualquer site com mapa do Google; quem está no mapa do servidor vê onde você abriu.
- **O bot do Spotify:** quem põe o bot na call conecta a própria conta do Spotify no app. As chaves dessa conta ficam só no computador dela, criptografadas como a sessão, e os pedidos ao Spotify saem de lá. Quem está na call manda os comandos (pular, buscar, pôr na fila) direto pro computador de quem pôs o bot (P2P). O servidor do Resenha só fica sabendo o nome da música que está tocando, pra mostrar na lista do canal de voz. As capas vêm direto do Spotify, então o Spotify vê o IP de quem está na call com o bot.

**O print que você manda pra importar canais do Discord** vai pro servidor do Resenha e de lá pra um modelo de inteligência artificial da própria Cloudflare (Workers AI), que lê os nomes dos canais. O print não fica guardado: depois de lido, só a lista de canais volta pro app, e nada é criado antes de você conferir.

**Os rabiscos** que você faz na transmissão de alguém vão direto pra pessoa que está compartilhando (P2P, como a voz), aparecem por alguns segundos no monitor dela e não ficam guardados em lugar nenhum. Quem compartilha pode desligar os rabiscos no painel da transmissão.

## Avisos no celular

No app de Android, os avisos de mensagem privada, de ligação e de mensagem de servidor (conforme o nível de aviso que você escolheu em cada servidor) chegam pelo Firebase Cloud Messaging, do Google:

- O celular manda pro servidor do Resenha um código do aparelho (o token do Firebase), com o idioma e a opção "Mostrar o texto da mensagem". O servidor guarda esse código com a sua conta até você sair da conta, encerrar aquela sessão, a sessão vencer (30 dias sem uso) ou o Firebase dizer que ele não vale mais.
- Cada aviso passa pelo Google com o nome de quem mandou, o canal e o servidor (ou "fulano está ligando") e até 300 caracteres da mensagem. Com "Mostrar o texto da mensagem" desligado (Configurações → Notificações), o texto vira só "Mensagem nova"; o nome e o lugar continuam indo.
- O servidor não manda aviso com "Não perturbe" ligado, nem enquanto você está usando o Resenha no computador (janela em foco e mexida nos últimos 2 minutos).

## Onde ficam os dados

Os dados ficam na Cloudflare (Workers e Durable Objects), nos Estados Unidos: hoje os Durable Objects do Resenha rodam em Miami, Chicago, Nova York e Atlanta. Os arquivos ficam no mesmo lugar das mensagens.

Além da Cloudflare (que também faz o retransmissor e o SFU das salas "pelo Cloudflare", a leitura do print do Discord e, no cadastro aberto, a verificação anti-robô, o Turnstile), o Resenha fala com:

- **Google (Firebase Cloud Messaging)**, só no celular, pros avisos (acima).
- **OpenFreeMap, Nominatim e Google (Street View)**, no mapa.
- **GitHub**, pra procurar versão nova: o app pergunta ao abrir e a cada 30 minutos no computador, e a cada 6 horas no celular.
- **Google**, no Linux, pra baixar os dicionários do corretor ortográfico.
- **Spotify**, se alguém puser o bot na call (acima).

Fora o texto dos avisos do celular, nenhum deles recebe as suas mensagens, a sua senha ou a sua lista de amigos.

## Seus direitos (LGPD)

- **Ver e levar seus dados:** em Configurações → Privacidade → Baixar meus dados (perfil, aparelhos, servidores, amigos e bloqueios, num arquivo JSON).
- **Corrigir:** você muda nome, foto e perfil quando quiser.
- **Apagar mensagens:** você apaga qualquer mensagem sua, a qualquer momento.
- **Excluir a conta:** em Configurações → Privacidade → Excluir conta. Seu perfil, fotos, sessões, amizades, bloqueios e os códigos de aviso do celular são apagados na hora. As mensagens que você mandou continuam nas conversas, mas aparecem como de "Usuário excluído", sem nome nem foto, como no Discord. Se quiser que elas sumam também, apague-as antes de excluir a conta.

## Segurança

- Conexões sempre por HTTPS/WSS.
- No computador, o app guarda a sua sessão criptografada com o chaveiro do sistema, quando o sistema tem um. No Android, ela fica no armazenamento do próprio app, que outros apps não leem, e fora do backup na nuvem.
- Links de arquivos são assinados e expiram; arquivos enviados nunca rodam como página.
- A página do app só fala com o servidor configurado, com o OpenFreeMap e a busca do OpenStreetMap (no mapa) e, no celular, com o GitHub (atualização); de fora, só mostra as capas do Spotify e o Street View do Google, numa moldura isolada (política de segurança de conteúdo). O que vem de fora nunca roda como código.

## Mudanças

Se esta política mudar, o aviso vai junto da atualização do app.
