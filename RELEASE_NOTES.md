## 1.12.0: o caminho mais curto na call

- **"Conectando…" só quando cai de verdade:** a conexão com o servidor é trocada de lugar pelo Cloudflare de tempos em tempos, pra todo mundo. O app já voltava sozinho sem tirar ninguém da call; agora volta na hora, sem aviso, e o "Conectando…" só aparece se ficar mais de 4 segundos fora.
- **O chat não pisca na reconexão:** as mensagens continuam na tela (sem perder onde você estava lendo) e o que chegou nesse meio-tempo aparece.
- **Melhor caminho na conexão direta:** quando os dois PCs têm IPv4 e IPv6, o app mede o ping pelos dois e, se um for bem menor, a call passa pra ele sozinha (uma vez, com o som sumindo por um segundo). Nada vai pelo Cloudflare: sala direta continua direta. Dá pra desligar em Configurações → Voz e vídeo → Call.
- **Sala pelo Cloudflare ligada no meio da call agora vale na hora:** até aqui, quem já estava na call continuava direto até sair e entrar de novo. Agora a conexão é refeita pelo Cloudflare (o som some por um segundo).
- **Por onde vai a call:** passando o mouse em alguém na call, a dica do ping mostra se a conexão vai por IPv4 ou IPv6, e o ping pelo outro caminho quando dá pra medir.
- **Atualizar com o bot do Spotify ligado** não deixa mais o player dele (o librespot) rodando escondido depois que o app fecha.

## Como atualizar

Clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização).
