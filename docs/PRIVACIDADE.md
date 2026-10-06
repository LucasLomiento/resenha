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

**O seu IP não fica guardado.** Para limitar tentativas de senha, o servidor guarda só um código embaralhado do IP (HMAC), que não permite descobrir o IP de volta, e apaga esses registros em até um dia.

## O que não passa pelo servidor

- **Voz, câmera e compartilhamento de tela** vão direto entre os computadores (P2P), criptografados (DTLS-SRTP). O servidor só ajuda os dois lados a se encontrarem. Quando a rede impede a ligação direta, a mídia pode passar por um retransmissor (TURN) da Cloudflare, ainda criptografada: o retransmissor não consegue ver nem ouvir o conteúdo.
- **Prévias de link** são buscadas pelo servidor, e as imagens delas passam por ele. Assim o site do link nunca vê o IP de quem está lendo a conversa.

Por ser P2P, quem está na mesma call que você vê o seu endereço IP (é assim que a ligação direta funciona). Se isso for um problema, não entre em call com quem você não conhece.

## Onde ficam os dados

Os dados ficam na Cloudflare (Workers e Durable Objects), com preferência pela região da América do Sul. Os arquivos ficam no mesmo lugar das mensagens. Nada é enviado para terceiros.

## Seus direitos (LGPD)

- **Ver e levar seus dados:** em Configurações → Conta → Exportar meus dados.
- **Corrigir:** você muda nome, foto e perfil quando quiser.
- **Apagar mensagens:** você apaga qualquer mensagem sua, a qualquer momento.
- **Excluir a conta:** em Configurações → Conta → Excluir conta. Seu perfil, fotos, sessões, amizades e bloqueios são apagados na hora. As mensagens que você mandou continuam nas conversas, mas aparecem como de "Usuário excluído", sem nome nem foto, como no Discord. Se quiser que elas sumam também, apague-as antes de excluir a conta.

## Segurança

- Conexões sempre por HTTPS/WSS.
- O app guarda a sua sessão criptografada com o chaveiro do sistema.
- Links de arquivos são assinados e expiram; arquivos enviados nunca rodam como página.
- O app só fala com o servidor configurado (política de segurança de conteúdo), e o que vem de fora nunca roda como código.

## Mudanças

Se esta política mudar, o aviso vai junto da atualização do app.
