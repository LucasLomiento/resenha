# Como instalar o Resenha

Você vai precisar de duas coisas:

1. **O app**, na página de [Releases](https://github.com/LucasLomiento/resenha/releases/latest).
2. **Um convite** que quem administra o servidor te manda: um código curto, tipo `aB3x_9Kq`.

O servidor é automático: não precisa configurar nada.

Depois de instalado, o app **se atualiza sozinho**. Quando sai versão nova aparece **Atualizar** no topo da barra lateral.

---

## Windows

1. Na página de [Releases](https://github.com/LucasLomiento/resenha/releases/latest), baixe o **`Resenha-Setup-….exe`** e abra.
2. Se aparecer **"O Windows protegeu o computador"**, clique em **Mais informações** e depois em **Executar assim mesmo**. O aviso aparece porque o app não tem assinatura digital paga, não porque tenha algo errado.
3. Siga o instalador. Ele cria atalho na área de trabalho e no menu Iniciar.
4. Se o **Firewall do Windows** perguntar, marque **Redes privadas** e clique em **Permitir acesso**. Sem isso, a conexão direta da call pode falhar.

Prefere não instalar? Tem também o **`.zip`**: é só extrair e abrir o `Resenha.exe`. Mas essa versão não se atualiza sozinha.

**Pra transmitir a tela com áudio sem mandar a voz da call junto, precisa de Windows 10 22H2 ou Windows 11.** Em Windows mais antigo funciona, mas o áudio da tela leva a voz de todo mundo junto. Pra ver sua versão, aperte `Win + R`, digite `winver` e dê Enter.

### Microfone não funciona?

Vá em **Configurações → Privacidade e segurança → Microfone** e ligue **"Permitir que aplicativos da área de trabalho acessem o microfone"**.

---

## Linux

**Arch / CachyOS / Omarchy / Manjaro:** baixe o `Resenha-…-x64.pacman` e rode:

```bash
sudo pacman -U ~/Downloads/Resenha-*-x64.pacman
```

**Outras distros (Ubuntu, Fedora…):** baixe o `Resenha-…-x86_64.AppImage` e rode:

```bash
chmod +x ~/Downloads/Resenha-*.AppImage
~/Downloads/Resenha-*.AppImage
```

O áudio da tela no Linux precisa do **PipeWire**, que já é o padrão nas distros atuais.

Pra atualizar pelo app no pacote `.pacman`, ele pede a sua senha: numa janelinha do sistema (KDE) ou num terminal que abre sozinho.

---

## Primeiro acesso

1. Abra o app e clique em **"Tenho um convite, quero criar conta"**.
2. Escolha um apelido e uma senha, cole o **convite** e clique em **Criar conta**. Cada convite vale pra uma conta só e vence em 7 dias.
3. Pronto. Da próxima vez o app já abre logado.

## Usando

- **Entrar na call:** clique no canal de voz (o com ícone de alto-falante). Pra sair, use o botão do telefone riscado no painel de baixo.
- **Mutar e ensurdecer:** são os botões de microfone e de fone no canto de baixo.
- **Webcam:** com a call aberta, clique no botão de câmera no painel de baixo. Pra ver a câmera de todo mundo, clique em "Voz conectada" ou no canal de voz: abre a tela da call, com um bloco por pessoa.
- **Volume de cada pessoa:** clique no nome dela dentro do canal de voz.
- **Compartilhar a tela:** com a call aberta, clique no ícone de monitor no painel de baixo, escolha a qualidade (até 1440p a 60 fps) e se quer mandar o áudio. Do outro lado aparece **AO VIVO** do lado do seu nome, e é só clicar pra assistir.
- **Mandar imagens e arquivos:** use o clipe do lado do campo de mensagem, cole um print com `Ctrl+V` ou arraste o arquivo pra dentro do chat. O limite é 25 MB por arquivo. Imagens são comprimidas antes de enviar.
- **Mudar a qualidade no meio da transmissão:** clique de novo no ícone de monitor. Dá pra trocar a resolução, a prioridade e o codec sem parar, e ver quantas pessoas estão assistindo.
- **Mensagem privada:** clique na pessoa em **Mensagens diretas**, na barra lateral.
- **Miniatura:** enquanto assiste, você pode voltar pro chat e a transmissão vira uma miniatura que dá pra arrastar e redimensionar. Também tem a **janela flutuante**, que fica por cima de tudo, até de outros apps.
- **Atalhos:** em Configurações → Atalhos você escolhe teclas pra mutar, ensurdecer, compartilhar a tela, sair da call e mostrar o Resenha. O padrão é `Ctrl+Shift+M` pra mutar e `Ctrl+Shift+D` pra ensurdecer.
- **Bandeja, abrir com o computador, sons e zoom:** em Configurações → App. O ícone da bandeja fica verde enquanto você fala e muda quando você muta ou ensurdece. O zoom também funciona com `Ctrl +`, `Ctrl −` e `Ctrl 0`.
- **Configurações:** no botão de ajustes, no canto de baixo. Lá dá pra escolher microfone, saída de áudio e codec de vídeo. O **Testar microfone** toca a sua voz de volta (use fone).
- **Ruído e limiar:** em Configurações → Voz. A **redução de ruído** com RNNoise tira teclado, ventilador e barulho de fundo. O **limiar do microfone** só transmite quando você fala: no automático ele reconhece a voz, no manual você arrasta a marca no medidor.

## Problemas comuns

- **A call conecta, mas ninguém se ouve, ou o ping não aparece:** a rede de algum dos dois está bloqueando a conexão direta. Confira se o app foi liberado no Firewall do Windows (passo 4) e avise quem administra o servidor.
- **Transmissão travando:** em Configurações → Tela, baixe a qualidade pra 1080p ou 720p, ou troque o codec pra **H264**. Cada pessoa assistindo consome upload de quem transmite.
