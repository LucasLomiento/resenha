## 1.4.0: tela pelo Cloudflare quando várias pessoas assistem

- **Transmitir pra duas ou mais pessoas pesa bem menos:** antes, cada pessoa assistindo custava uma codificação inteira do vídeo e o upload todo de novo (em 1440p60, uma pessoa a mais é ~12 Mbps e mais CPU tirada do jogo). Agora, quando a segunda pessoa pede pra assistir, a tela sobe uma vez só pro servidor de mídia do Cloudflare (SFU), que distribui pra quem estiver vendo. Com uma pessoa só continua direto, como antes, com o menor atraso. A troca não pisca: a cópia direta só para depois que a imagem pelo Cloudflare chegou. O atraso sobe pouco (uns 15 ms no teste). Nas estatísticas da transmissão aparece "via Cloudflare".
- **Conexão que não fecha direto:** quando a rede de alguém não deixa a ligação direta (alguns provedores com CGNAT), a call passa pelo retransmissor (TURN) do Cloudflare em vez de falhar.
- **Sem custo:** o Cloudflare dá 1.000 GB por mês de graça pros dois. Os apps contam o que passa e o Resenha para de usar o Cloudflare em 850 GB; aí tudo volta a ser direto até o mês virar. Em Configurações → Plataforma, o dono vê quanto já foi.
- **Privacidade:** pelo TURN o conteúdo passa criptografado e o Cloudflare não vê nada. Pelo SFU (só tela com 2 ou mais assistindo), o caminho é criptografado, mas o servidor abre a imagem e o som pra repassar, como todo servidor desse tipo; nada é gravado. A voz continua sempre direta.
- Quem estiver numa versão antiga continua recebendo a tela direto.

## Como atualizar

Clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização).
