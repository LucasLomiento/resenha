# Como instalar o Resenha

Você vai precisar de duas coisas:

1. **O app**, na página de [Releases](https://github.com/LucasLomiento/resenha/releases/latest).
2. **Um convite**: o link que alguém de um servidor te manda, tipo `https://resenha.lucaslomiento.workers.dev/i/aB3x9Kq`. Com o app instalado, o link abre direto nele.

O servidor é automático: não precisa configurar nada.

Depois de instalado, o app **se atualiza sozinho**. Quando sai versão nova, aparece um botão de download no pé da coluna de servidores, à esquerda (ou em Configurações → Aplicativo).

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

1. Abra o link do convite (ele abre o app) ou abra o app e clique em **Criar conta**.
2. Escolha um **nome de usuário** (único, é com ele que você entra), um **nome de exibição** (como aparece pros outros) e uma senha de pelo menos 8 caracteres. Se o convite não veio preenchido, cole o código ou o link.
3. Pronto: você já entra no servidor do convite. Da próxima vez o app abre logado.

**Já usava antes da 1.0?** Nada muda: o app atualiza e continua logado, com todas as mensagens. Se precisar entrar de novo, vale o apelido antigo ou o nome de usuário novo (aparece embaixo do seu nome, no canto de baixo).

## Usando

- **Servidores:** a coluna da esquerda tem a casinha do **Início** (amigos e mensagens privadas) e os seus servidores. O **+** cria um servidor ou entra em outro com convite.
- **Convidar alguém:** clique no nome do servidor, no topo, e em **Convidar pessoas**. Dá pra escolher por quanto tempo o link vale e quantas pessoas podem usar.
- **Amigos e mensagens privadas:** ficam no **Início**. Pra falar com alguém, clique no nome da pessoa (no chat ou na lista de membros) e em **Mensagem**. Na conversa, os botões de telefone e câmera, no topo, fazem uma ligação.
- **Entrar na call:** clique no canal de voz (o com alto-falante). A call aparece no painel de baixo, à esquerda, e o telefone vermelho sai dela.
- **Mutar e ensurdecer:** botões de microfone e de fone, no painel de baixo.
- **Câmera e tela:** com a call aberta, use os botões de câmera e de tela no painel de baixo. Na tela, escolha a qualidade (até 1440p a 60 fps) e se quer mandar o áudio. Do outro lado aparece **AO VIVO**, e é só clicar pra assistir. Clicando de novo no botão da tela dá pra trocar a qualidade e o codec sem parar e ver quantas pessoas estão assistindo.
- **Ver todo mundo da call:** clique em **Na call**, no painel de baixo, ou no canal de voz: abre a tela da call, com um bloco por pessoa.
- **Volume de cada pessoa:** clique no nome dela dentro do canal de voz.
- **Assistindo:** dá pra voltar pro chat e a transmissão vira uma miniatura que se arrasta e redimensiona. Também tem a **janela flutuante**, que fica por cima de tudo, até de outros apps.
- **Mensagens:** passe o mouse numa mensagem pra reagir, responder, editar ou fixar; o **⋯** tem o resto. `@` menciona alguém e `#` um canal. Com o campo vazio, **↑** edita a sua última mensagem. A busca fica no topo do chat.
- **Imagens e arquivos:** clipe ao lado do campo, `Ctrl+V` com um print, ou arraste pro chat. Até 25 MB por arquivo.
- **Pular pra qualquer canal ou conversa:** `Ctrl+K`. `Alt+↑` e `Alt+↓` vão pro canal de cima e de baixo.
- **Status:** clique na sua foto, no painel de baixo: online, ausente, não perturbe, invisível ou um texto seu.
- **Configurações** (engrenagem no painel de baixo):
  - **Perfil:** foto, nome, "sobre mim" e cor.
  - **Aparelhos:** onde a sua conta está aberta; dá pra sair de um ou de todos.
  - **Voz e vídeo:** microfone, saída, redução de ruído, "só transmitir quando eu falar", câmera e codec da transmissão. A **redução de ruído** (RNNoise) tira teclado, ventilador e barulho de fundo.
  - **Notificações:** sons e avisos do sistema (dá pra esconder o texto da mensagem, bom quando a tela está sendo compartilhada).
  - **Atalhos:** teclas pra mutar, ensurdecer, compartilhar a tela, sair da call e mostrar o Resenha. O padrão é `Ctrl+Shift+M` pra mutar e `Ctrl+Shift+D` pra ensurdecer.
  - **Aplicativo:** abrir com o computador, bandeja, tamanho da interface (também com `Ctrl +`, `Ctrl −` e `Ctrl 0`) e atualizações.
  - **Privacidade:** quem pode te mandar mensagem privada, bloqueados, baixar uma cópia dos seus dados e excluir a conta.
- **No seu servidor** (ou se o seu cargo deixar): o menu no nome do servidor tem **Configurações do servidor**, com cargos, membros, convites, banimentos e o registro de tudo que a moderação fez. Os canais se organizam arrastando na lista, e a engrenagem de cada canal abre as configurações e as permissões dele.

## Problemas comuns

- **A call conecta, mas ninguém se ouve, ou o ping não aparece:** a rede de algum dos dois está bloqueando a conexão direta. Confira se o app foi liberado no Firewall do Windows (passo 4) e avise quem administra o servidor.
- **Transmissão travando:** clique no botão da tela, no painel de baixo, e baixe a qualidade pra 1080p ou 720p, ou troque o codec pra **H264**. Cada pessoa assistindo consome upload de quem transmite.
