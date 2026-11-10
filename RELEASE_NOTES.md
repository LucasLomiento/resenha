## 1.18.0: enquetes, apertar pra falar e código colorido

- **Enquetes nos canais.** O botão novo ao lado do clipe abre "Nova enquete": a pergunta, de 2 a 10 opções, uma resposta ou várias, e um prazo (ou sem prazo). Todo mundo vê o resultado na hora e quem votou em quê; quem criou (ou quem modera) encerra quando quiser.
- **Apertar pra falar.** Em Configurações → Atalhos, escolha a "Tecla de falar": o microfone só abre enquanto você segura ela, mesmo com um jogo em foco. Funciona no Linux com Wayland (Hyprland, KDE, GNOME); onde o sistema não deixa, a opção nem aparece.
- **Código colorido no chat.** Bloco de código com a linguagem (` ```js `, `py`, `sh`, `json`…) ganha cores, e passando o mouse aparece o botão de copiar.
- **Calls mais firmes.** Uma resposta repetida da conexão podia deixar a call renegociando sem parar; não deixa mais. Quem saía da call com a internet caída não fica mais "preso" na lista da sala. Atender logo depois de clicar numa sala funciona, e atender uma ligação que já acabou não liga de volta sozinho.
- **Câmera e tela respeitam a permissão da sala**: sem a permissão de vídeo, os botões ficam apagados (antes a câmera ligava e ninguém via).
- **O celular avisa na hora** mesmo que o computador tenha dormido com o Resenha aberto (antes podia segurar o aviso por uns 6 minutos).
- **Mensagens depois de uma queda**: o reenvio automático não bagunça mais as não lidas, e uma mensagem só com imagem não volta com "o anexo não está mais disponível". Mensagem de voz tenta de novo antes de desistir, em vez de perder a gravação.
- **Servidor mais econômico e mais difícil de derrubar**: menos chamadas internas a cada mensagem e a cada reconexão, e vários freios novos contra app em laço e contra quem tenta gastar o limite do dia de propósito.
- Quem ainda estiver na 1.17 numa sala pelo Cloudflare vê a transmissão pela conexão direta até atualizar.

## Como atualizar

No computador: clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização). No celular: o app avisa e abre o download do APK novo; é só instalar por cima.
