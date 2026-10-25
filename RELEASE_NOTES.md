## 1.17.0: o Resenha aguenta app com problema

- **Um app com problema não derruba mais o Resenha de todo mundo.** Em 25/10 uma chamada privada entrou em laço e gastou num dia o limite inteiro do servidor; ficou tudo fora até as 21h. Agora o próprio app tem um teto do que manda, o servidor encerra a chamada que entrar em laço (aparece "A chamada teve um problema e foi encerrada. Liguem de novo.") e quem mandar coisa demais é pausado por alguns minutos, sem afetar os outros.
- **Chamadas mais firmes**: quando os dois lados refaziam a conexão ao mesmo tempo, às vezes a chamada ficava sem som pros dois; não fica mais. E uma conexão que não fecha direto tenta de novo com calma, em vez de sem parar.
- **Mapa mais leve**: mexer no mapa sozinho não manda nada pros outros (só a posição final), e com mais gente ele manda menos atualizações por segundo, com o movimento ainda suave.
- **Pra quem cuida da plataforma**: Configurações → Plataforma mostra os pedidos do dia ao servidor, quem mais gastou (com o nome), os apps que o servidor freou e a versão do app de cada conta. Perto do limite, o dono recebe um aviso e o cadastro aberto pausa sozinho até o dia virar.
- Quem fecha o notebook ou perde a rede sem sair do app pode aparecer online por alguns minutos a mais.

## Como atualizar

No computador: clique no botão de download no pé da coluna de servidores, à esquerda (ou Configurações → Aplicativo → Procurar atualização). No celular: o app avisa e abre o download do APK novo; é só instalar por cima.
