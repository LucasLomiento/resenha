## 0.5 — Segurança

Primeira etapa do caminho até a 1.0 ([roteiro](https://github.com/LucasLomiento/resenha/blob/main/docs/ROADMAP.md)).

- **O áudio da tela não leva mais a sua call do Discord.** Por padrão entra o som de todos os apps, menos os de voz (Discord, Vesktop, TeamSpeak, Mumble, Zoom, Teams…). Também dá pra escolher só os apps que quiser, na hora de compartilhar (Linux).
- **O login não aparece mais em log nenhum.** O código da sessão ia no endereço da conexão, que fica registrado nos logs do servidor; agora vai dentro da conexão já aberta.
- **Login salvo criptografado no chaveiro do sistema** também no Hyprland e em outros ambientes sem KDE/GNOME (antes ficava em texto puro).
- **Notificações podem esconder o texto da mensagem** (Configurações → App), útil quando a tela está sendo compartilhada.
- **Janela mais blindada:** a página do app só consegue falar com o servidor do Resenha, e o processo principal só atende a própria janela.

## Como atualizar

Clique em **Atualizar** no topo da barra lateral (ou Configurações → App → Procurar atualização).
