## 1.2.0: rabiscos na tela

- **Rabiscar na tela de quem compartilha** (como nas calls do Slack): assistindo uma transmissão, clique no lápis do player e desenhe por cima. Quem compartilha vê os rabiscos direto no monitor dele, por cima de tudo (até de jogo em tela cheia), com o seu nome e a sua cor, e quem assiste vê pela própria transmissão.
  - **Laser** (o traço some em menos de um segundo) ou **Caneta** (fica uns segundos). Um clique rápido marca um ponto ("olha aqui"). Esc sai do modo de rabiscar.
  - Só funciona compartilhando o **monitor inteiro**. A resolução de cada um não importa.
  - Quem compartilha pode **limpar** ou **desligar** os rabiscos no painel da transmissão (botão "Ao vivo"). Com mais de um monitor, o app tenta descobrir qual está sendo transmitido; se não der, pergunta ali.
  - No Linux, o pacote agora instala `gtk4-layer-shell` e `python-gobject` (usados pra desenhar por cima da tela). Funciona no Hyprland e no KDE; no GNOME não dá.
- **Correção:** ao completar uma @menção com Tab, quem digitava muito rápido às vezes escrevia antes do cursor pular.

## Como atualizar

Clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização). No Linux, a atualização instala junto os dois pacotes novos.
