# Como instalar o Resenha

Você vai precisar de duas coisas:

1. **O app**, na página de [Releases](https://github.com/LucasLomiento/resenha/releases/latest).
2. **Um convite** que quem administra o servidor te manda: um código curto, tipo `aB3x_9Kq`.

O endereço do servidor já vem preenchido no app.

---

## Windows

1. Na página de [Releases](https://github.com/LucasLomiento/resenha/releases/latest), baixe o **`Resenha-…-win-x64.zip`**.
2. Clique com o botão direito no arquivo baixado e escolha **Extrair tudo…**. Mande extrair pra uma pasta fixa, por exemplo `Documentos\Resenha`. Não rode de dentro do zip.
3. Abra a pasta extraída e dê dois cliques em **`Resenha.exe`**.
4. Se aparecer **"O Windows protegeu o computador"**, clique em **Mais informações** e depois em **Executar assim mesmo**. O aviso aparece porque o app não tem assinatura digital paga, não porque tenha algo errado.
5. Se o **Firewall do Windows** perguntar, marque **Redes privadas** e clique em **Permitir acesso**. Sem isso, a conexão direta da call pode falhar.
6. Pra ter um atalho, clique com o botão direito em `Resenha.exe` e escolha **Enviar para → Área de trabalho (criar atalho)**.

**Pra transmitir a tela com áudio sem mandar a voz da call junto, precisa de Windows 10 22H2 ou Windows 11.** Em Windows mais antigo funciona, mas o áudio da tela leva a voz de todo mundo junto. Pra ver sua versão, aperte `Win + R`, digite `winver` e dê Enter.

### Microfone não funciona?

Vá em **Configurações → Privacidade e segurança → Microfone** e ligue **"Permitir que aplicativos da área de trabalho acessem o microfone"**.

---

## Linux

**Arch / Omarchy / Manjaro:** baixe o `Resenha-…-x64.pacman` e rode:

```bash
sudo pacman -U ~/Downloads/Resenha-*-x64.pacman
```

**Outras distros (Ubuntu, Fedora…):** baixe o `Resenha-…-x86_64.AppImage` e rode:

```bash
chmod +x ~/Downloads/Resenha-*.AppImage
~/Downloads/Resenha-*.AppImage
```

O áudio da tela no Linux precisa do **PipeWire**, que já é o padrão nas distros atuais.

---

## Primeiro acesso

1. Abra o app e clique em **"Tenho um convite, quero criar conta"**.
2. Escolha um apelido e uma senha, cole o **convite** e clique em **Criar conta**. Cada convite vale pra uma conta só e vence em 7 dias.
3. Pronto. Da próxima vez o app já abre logado.

## Usando

- **Entrar na call:** clique no canal de voz (o com ícone de alto-falante). Pra sair, use o botão do telefone riscado no painel de baixo.
- **Mutar e ensurdecer:** são os botões de microfone e de fone no canto de baixo.
- **Volume de cada pessoa:** clique no nome dela dentro do canal de voz.
- **Compartilhar a tela:** com a call aberta, clique no ícone de monitor no painel de baixo, escolha a qualidade (até 1440p a 60 fps) e se quer mandar o áudio. Do outro lado aparece **AO VIVO** do lado do seu nome, e é só clicar pra assistir.
- **Mandar imagens e arquivos:** use o clipe do lado do campo de mensagem, cole um print com `Ctrl+V` ou arraste o arquivo pra dentro do chat. O limite é 25 MB por arquivo.
- **Configurações:** no botão de ajustes, no canto de baixo. Lá dá pra escolher microfone, saída de áudio, supressão de ruído e codec de vídeo.

## Problemas comuns

- **A call conecta, mas ninguém se ouve, ou o ping não aparece:** a rede de algum dos dois está bloqueando a conexão direta. Confira se o app foi liberado no Firewall do Windows (passo 5) e avise quem administra o servidor.
- **Transmissão travando:** em Configurações → Tela, baixe a qualidade pra 1080p ou 720p, ou troque o codec pra **H264**. Cada pessoa assistindo consome upload de quem transmite.
