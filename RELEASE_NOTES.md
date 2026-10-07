## 1.2.1: o lápis dos rabiscos aparece no Linux

- **Correção:** no Linux (Wayland: Hyprland, KDE), o lápis pra rabiscar não aparecia pra quem assistia, mesmo com o monitor inteiro compartilhado. O sistema informa toda captura como "janela"; agora o app olha o formato da imagem transmitida.
- **O monitor certo sozinho:** com dois monitores do mesmo tamanho, o app descobre qual você está transmitindo. Um quadradinho rosa pisca por um instante no canto de cima à esquerda quando a transmissão começa: é ele procurando. Se não conseguir, pergunta no painel "Ao vivo".

### Da 1.2.0

- **Rabiscar na tela de quem compartilha** (como nas calls do Slack): assistindo uma transmissão, clique no lápis do player e desenhe por cima. Quem compartilha vê os rabiscos direto no monitor dele, por cima de tudo, com o seu nome e a sua cor.
  - **Laser** (some em menos de um segundo) ou **Caneta** (fica uns segundos). Um clique rápido marca um ponto. Esc sai.
  - Só funciona compartilhando o **monitor inteiro**. A resolução de cada um não importa.
  - Quem compartilha pode **limpar** ou **desligar** os rabiscos no painel "Ao vivo".

## Como atualizar

Clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização). Quem compartilha a tela precisa estar na 1.2.1.
