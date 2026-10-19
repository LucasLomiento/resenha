## 1.15.0: revisão geral (dezenas de correções)

Uma revisão do app inteiro, do servidor ao celular. O que mais muda no dia a dia:

**Privacidade**
- **Invisível e Não perturbe valem pros amigos de verdade.** Ao abrir o app (ou escolhendo o status no celular com o computador aberto), os amigos chegavam a te ver online até a conexão cair.
- **A mensagem de voz vai pra conversa em que foi gravada**, mesmo se você trocar de conversa enquanto ela converte.
- **Câmera e tela não ficam ligadas sozinhas:** se a call acabava enquanto o seletor de tela ou a câmera abriam, a captura continuava. Clique duplo na câmera também não deixa mais a luz acesa.
- No celular, o login não vai mais pro backup do Google.

**Calls e ligações**
- **Nada de sair da conta sozinho logo depois de uma reconexão** (às vezes o app achava que a sessão tinha vencido).
- **Ligação privada:** o toque não fica tocando pra sempre com duas ligações ao mesmo tempo; a ligação aparece ao abrir o app pelo aviso do celular; desligar enquanto a internet caía não te deixa "na ligação" pro outro; entrar pelo celular tira o computador da ligação, avisando.
- **Canal cheio, sem permissão ou apagado:** o app não fica mais numa call fantasma (som de entrada, microfone aberto e ninguém ouvindo).
- Sem a permissão de falar no canal, ninguém ouve a pessoa (antes só aparecia o ícone de mutado).
- Microfone que desconecta no meio da call (fone sem bateria) volta pro padrão, avisando. Sem microfone nenhum, dá pra entrar só pra ouvir.

**Chat**
- **Menu do clique direito:** copiar, colar, copiar link e as sugestões do corretor.
- **Prévias de link não perdem mais a imagem** depois de uns dias.
- A linha "Novas" aparece ao abrir a conversa, e pular pra mensagem respondida funciona também nas mensagens privadas.
- Esc fecha as sugestões de @, # e : sem estragar o texto; o rascunho não some ao abrir Amigos; "Reagir" pelo clique direito abre o seletor; "Copiar texto" mantém o código como foi escrito.
- Mensagem que ficou sem resposta numa queda vai de novo sozinha, sem duplicar.
- Emojis com nome em inglês e espanhol na busca.
- Avisos do sistema mostram os nomes no lugar dos códigos e escondem spoiler.

**Celular**
- Com o app aberto, mensagem nova não vira mais aviso do sistema por cima.
- A notificação "Na call" some quando você fecha o app pelos recentes.

**Computador**
- Os rabiscos voltam a funcionar em instalação nova do Arch e do CachyOS (faltava um pacote).
- No GNOME sem a extensão da bandeja, fechar a janela não esconde mais o app pra sempre.
- Licenças dos componentes em Configurações → Aplicativo.

E muita coisa no servidor: limites mais justos contra abuso, a cota de mídia do Cloudflare que não estoura, e menos consumo.

## Como atualizar

No computador: clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização). No celular: o app avisa e abre o download do APK novo; é só instalar por cima.
