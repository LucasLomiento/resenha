# Política de privacidade

Esta política vale para quem usa um servidor do Resenha. Quem cuida do servidor (o "dono da instância") é quem responde pelos dados guardados nele. O Resenha não tem anúncios, não vende dados e não usa ferramentas de rastreamento ou de análise de comportamento.

## O que fica guardado no servidor

| Dado | Por quê | Até quando |
|---|---|---|
| Nome de usuário, nome de exibição, foto, "sobre mim", cor do perfil | Para os outros te reconhecerem | Até você mudar ou excluir a conta |
| Senha | Para você entrar. Fica só um resumo irreversível (PBKDF2-SHA256, 100 mil rodadas, com sal), nunca a senha | Até você trocar a senha ou excluir a conta |
| Sessões (aparelho, país, quando entrou e quando usou pela última vez) | Para você ver e derrubar os aparelhos conectados | 30 dias sem uso, ou até você sair |
| Mensagens, reações, arquivos enviados | Para a conversa existir | Até quem escreveu apagar, um moderador apagar, ou o servidor/canal ser excluído |
| Servidores de que você participa, cargos, apelidos | Para o servidor funcionar | Até você sair ou ser removido |
| Amizades, pedidos de amizade e bloqueios | Para a lista de amigos e para proteger você | Até você desfazer |
| Registro de moderação (quem expulsou, baniu, apagou mensagem de alguém…) | Para os administradores do servidor saberem o que aconteceu | 90 dias |
| Marcadores do mapa do servidor (lugar, nome, cor, quem marcou) e o último lugar que o mapa mostrou | Para todo mundo do servidor ver | Até quem marcou ou um moderador apagar, ou o servidor ser excluído |

**O seu IP não fica guardado.** Para limitar tentativas de senha, o servidor guarda só um código embaralhado do IP (HMAC), que não permite descobrir o IP de volta, e apaga esses registros em até um dia.

## O que não passa pelo servidor

- **Voz, câmera e compartilhamento de tela** vão direto entre os computadores (P2P), criptografados (DTLS-SRTP). O servidor só ajuda os dois lados a se encontrarem. Quando a rede impede a ligação direta, a mídia pode passar por um retransmissor (TURN) da Cloudflare, ainda criptografada: o retransmissor não consegue ver nem ouvir o conteúdo. **Quando duas ou mais pessoas assistem a sua tela**, ela passa pelo servidor de mídia da Cloudflare (SFU), que recebe uma cópia e repassa pra cada pessoa. O caminho continua criptografado, mas o SFU, como todo servidor desse tipo, abre a imagem e o som pra repassar. Nada é gravado. A voz continua direta. **Numa sala que o dono marcou como "pelo Cloudflare"** (nuvem ao lado do nome), voz e câmera também passam pelo retransmissor (TURN) dele, ainda criptografadas (o Cloudflare não ouve nem vê), e aí ninguém da sala fica sabendo o seu IP.
- **Prévias de link** são buscadas pelo servidor, e as imagens delas passam por ele. Assim o site do link nunca vê o IP de quem está lendo a conversa.
- **O mapa** (de cada servidor) é baixado direto do [OpenFreeMap](https://openfreemap.org), e a busca de endereço vai direto pro [Nominatim](https://nominatim.org) (OpenStreetMap). Como em qualquer site, esses serviços veem o seu IP e, na busca, o que você procurou. Só quando você abre o mapa ou busca algo. Onde você está olhando no mapa e o seu cursor vão só pra quem está com o mapa do mesmo servidor aberto, e não ficam guardados (a não ser o último lugar que o mapa mostrou). **O Street View** é o do Google, incorporado: quando você abre, o Google vê o seu IP e o lugar que você está vendo, como em qualquer site com mapa do Google; quem está no mapa do servidor vê onde você abriu.

**O print que você manda pra importar canais do Discord** vai pro servidor do Resenha e de lá pra um modelo de inteligência artificial da própria Cloudflare (Workers AI), que lê os nomes dos canais. O print não fica guardado: depois de lido, só a lista de canais volta pro app, e nada é criado antes de você conferir.

**Os rabiscos** que você faz na transmissão de alguém vão direto pra pessoa que está compartilhando (P2P, como a voz), aparecem por alguns segundos no monitor dela e não ficam guardados em lugar nenhum. Quem compartilha pode desligar os rabiscos no painel da transmissão.

Por ser P2P, quem está na mesma call que você vê o seu endereço IP (é assim que a ligação direta funciona). Se isso for um problema, não entre em call com quem você não conhece.

## Onde ficam os dados

Os dados ficam na Cloudflare (Workers e Durable Objects), com preferência pela região da América do Sul. Os arquivos ficam no mesmo lugar das mensagens. Fora o mapa (acima), nada é enviado para terceiros.

## Seus direitos (LGPD)

- **Ver e levar seus dados:** em Configurações → Conta → Exportar meus dados.
- **Corrigir:** você muda nome, foto e perfil quando quiser.
- **Apagar mensagens:** você apaga qualquer mensagem sua, a qualquer momento.
- **Excluir a conta:** em Configurações → Conta → Excluir conta. Seu perfil, fotos, sessões, amizades e bloqueios são apagados na hora. As mensagens que você mandou continuam nas conversas, mas aparecem como de "Usuário excluído", sem nome nem foto, como no Discord. Se quiser que elas sumam também, apague-as antes de excluir a conta.

## Segurança

- Conexões sempre por HTTPS/WSS.
- O app guarda a sua sessão criptografada com o chaveiro do sistema.
- Links de arquivos são assinados e expiram; arquivos enviados nunca rodam como página.
- O app só fala com o servidor configurado e, no mapa, com o OpenFreeMap e a busca do OpenStreetMap (política de segurança de conteúdo), e o que vem de fora nunca roda como código.

## Mudanças

Se esta política mudar, o aviso vai junto da atualização do app.
