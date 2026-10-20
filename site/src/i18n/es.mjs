// Textos do site em espanhol (neutro da América Latina, com “tú”). Mesmas chaves do pt.mjs
// (as regras estão lá).

export default {
  meta: {
    description:
      'Voz, chat y pantalla hasta 1440p a 60 fps para tu grupo, directo de una PC a la otra. Con garabatos en la pantalla de tu amigo, mapa compartido, Spotify en la llamada y un perfil a tu manera.',
    ogDescription: 'La llamada de tu grupo: voz, chat y pantalla, directo de una PC a la otra.',
  },

  channels: {
    'boas-vindas': 'bienvenida',
    baixar: 'descargar',
    call: 'llamada',
    'tela-ao-vivo': 'pantalla-en-vivo',
    rabiscos: 'garabatos',
    mapa: 'mapa',
    perfil: 'perfil',
    spotify: 'spotify',
    conexao: 'conexión',
    novidades: 'novedades',
  },

  common: {
    skip: 'Saltar al contenido',
    live: 'EN VIVO',
    bot: 'app',
    you: 'Tú',
    now: 'ahora',
  },

  rail: {
    label: 'Atajos',
    home: 'Inicio',
    server: 'Servidor de Resenha',
    download: 'Descargar',
    code: 'Código en GitHub',
  },

  side: {
    label: 'Canales',
    close: 'Cerrar los canales',
    start: 'Empieza aquí',
    app: 'Conoce la app',
    project: 'Proyecto',
    code: 'código',
  },

  dock: {
    inCall: 'En llamada',
    leave: 'Salir de la llamada',
    visitor: 'visitante',
    mute: 'Silenciar',
    deafen: 'Ensordecer',
  },

  head: {
    channels: 'Canales',
    prev: 'Canal anterior',
    next: 'Canal siguiente',
    download: 'Descargar',
    language: 'Idioma',
  },

  welcome: {
    topic: 'Empieza por aquí: qué es Resenha y cómo recorrer este sitio.',
    live: 'En vivo',
    version: 'versión {{VERSION}}',
    title: 'La llamada de tu grupo.',
    lede: 'Voz, chat y pantalla para tu grupo, directo de una PC a la otra. Transmisión hasta 1440p a 60 fps con el sonido del juego, garabatos en la pantalla de tu amigo, mapa compartido y Spotify sonando en la llamada.',
    download: 'Descargar Resenha',
    tour: 'Hacer el recorrido',
    today: 'Hoy',
    hello:
      'Esto es un Resenha de mentira. 👋 Los canales de la izquierda son las partes de la app: haz clic en cualquiera, o usa las flechas de arriba para ir de uno en uno.',
    bia: "¿llamada hoy? extraño a la <span class='mention'>@banda</span>",
    ask: 'Puedes preguntarme algo aquí abajo (pantalla, garabatos, mapa, Spotify, descargar...).',
    placeholder: 'Mensaje en #{{channels.boas-vindas}}',
    message: 'Mensaje',
    send: 'Enviar',
  },

  call: {
    topic: 'Voz directo de una PC a la otra, sin servidor en el medio.',
    title: 'Entras y hablas.',
    text: 'La voz va directo de una PC a la otra. Reducción de ruido, detección de voz, volumen de cada uno hasta 200% y el mejor camino (IPv4 o IPv6) elegido solo.',
    muted: 'silenciado',
  },

  screen: {
    topic: 'Compartir pantalla: hasta 1440p a 60 fps, con el sonido del juego.',
    title: '1440p, 60 cuadros y el sonido del juego.',
    text: 'Comparte el monitor o una ventana. El sonido va en estéreo y la voz de la llamada queda fuera: nadie se escucha doble. Elige la calidad y mira qué cambia:',
    quality: 'Calidad',
    q720: 'Más liviana',
    q1080: 'Full HD',
    q1440: 'Máxima',
  },

  ink: {
    topic: 'Quien mira dibuja encima, y aparece en el monitor de quien comparte.',
    title: 'Garabatea en la pantalla de tu amigo.',
    text: 'Arrastra el mouse (o el dedo) sobre la pantalla. Láser para señalar, lápiz para marcar: en la app, eso aparece en el monitor de quien está transmitiendo.',
    tool: 'Herramienta',
    laser: 'Láser',
    pen: 'Lápiz',
    clear: 'Borrar',
    hint: 'Dibuja aquí',
  },

  map: {
    topic: 'Un mapa por servidor: lo arrastras y todos van contigo.',
    title: 'Todos en el mismo mapa.',
    text: 'Cursores en vivo, marcadores que quedan guardados en el servidor y Street View. Haz clic en el mapa para marcar un lugar.',
    pin: 'Pizzería',
    moving: 'Gabi está moviendo el mapa',
  },

  profile: {
    topic: 'Banner, foto animada, marco, efecto y nombre con estilo. Para todos.',
    title: 'El perfil es todo tuyo.',
    text: 'Tema de la tarjeta, marco, efecto y nombre con fuente y brillo. Para todos, sin pagar nada. Pruébalo aquí:',
    pronouns: 'ella',
    bio: 'Máster del rol de los jueves. No me llames antes de las 10.',
    theme: 'Tema de la tarjeta',
    themes: { ocean: 'Mar', sunset: 'Atardecer', forest: 'Bosque', candy: 'Algodón de azúcar', ember: 'Brasa' },
    frame: 'Marco',
    frames: { none: 'Ninguno', neon: 'Neón', aurora: 'Aurora', gold: 'Corona' },
    name: 'Nombre',
    names: { plain: 'Clásico', gradient: 'Degradado', neon: 'Neón' },
  },

  spotify: {
    topic: 'El bot de Spotify suena en la llamada, y cada uno lo escucha al volumen que quiera.',
    title: 'La música de la llamada.',
    text: 'Pon tu Spotify en la llamada: suena para todos en la sala, y cualquiera puede saltar, buscar y agregar a la cola. Haz clic en una canción:',
    prev: 'Anterior',
    next: 'Siguiente',
  },

  drop: {
    topic: 'La llamada aguanta caídas de internet, y la app se actualiza sola.',
    title: '¿Se cayó el internet? La llamada sigue.',
    text: 'Si vuelve en menos de 30 segundos, nadie sale de la sala y la pantalla sigue pasando. Pruébalo:',
    offline: 'Sin conexión. Reintentando…',
    back: 'De vuelta. Nadie salió de la llamada.',
    frame: 'cuadro',
    button: 'Tirar el internet',
  },

  updates: {
    topic: '{{COUNT}} versiones desde el {{FIRST_DATE}}. La app te avisa sola cuando sale la próxima.',
    title: 'Te damos la bienvenida a #{{channels.novidades}}',
    text: 'Todo lo que cambió en Resenha, de la versión más nueva a la más vieja.',
    older: 'Versiones anteriores',
    newest: 'más nueva',
    original: 'en portugués',
  },

  download: {
    topic: 'Versión {{VERSION}}, del {{VERSION_DATE}}. Una vez instalado, se actualiza solo.',
    title: 'Descargar Resenha',
    button: 'Descargar',
    copy: 'Copiar el comando',
    arch: { os: 'Arch, CachyOS, Omarchy', kind: 'Paquete .pacman' },
    linux: { os: 'Otras distros de Linux', kind: 'AppImage' },
    windows: {
      os: 'Windows 10 y 11',
      kind: 'Instalador',
      alt: "O el <a href='{{ZIP_URL}}'>.zip</a>, sin instalar (ese no se actualiza).",
    },
    android: {
      os: 'Android 7 o más nuevo',
      kind: 'App para celular (.apk)',
      alt: 'Fuera de la Play Store: la primera vez, Android te pide permitir la instalación. La app avisa cuando sale una versión nueva.',
    },
    account: 'Para entrar necesitas una cuenta: con una invitación de alguien del grupo, o directo, cuando el registro esté abierto.',
  },

  foot: {
    made: 'Hecho entre amigos, para amigos. Código abierto.',
    links: 'Enlaces',
    code: 'Código',
    privacy: 'Privacidad (en portugués)',
    terms: 'Términos (en portugués)',
  },

  js: {
    next: 'Siguiente',
    startTour: 'Empezar el recorrido',
    mute: 'Silenciar',
    unmute: 'Activar micrófono',
    deafen: 'Ensordecer',
    undeafen: 'Volver a escuchar',
    inCall: 'en llamada',
    visitor: 'visitante',
    join: 'Entrar a la llamada',
    leave: 'Salir de la llamada',
    noteOut: 'Los demás ya están ahí. El anillo verde muestra quién está hablando.',
    noteIn: 'Entraste. El micrófono y los audífonos de abajo, junto a tu nombre, también funcionan aquí.',
    noteMuted: 'Estás silenciado. Activa el micrófono abajo, junto a tu nombre.',
    inkYou: 'tú',
    pins: ['¡Aquí!', '¿Vamos?', 'Encuentro', 'Merienda', 'Salida'],
    genres: [['sertanejo', 'romántico'], ['pop'], ['rock brasileño'], ['bossa nova', 'mpb']],
    play: 'Reproducir',
    pause: 'Pausar',
    you: 'Tú',
    now: 'ahora',
    typing: '<b>Resenha</b> está escribiendo…',
    copy: 'Copiar el comando',
    copied: 'Copiado',
    cta: { windows: 'Descargar para Windows', android: 'Descargar para Android', linux: 'Descargar para Linux' },
    answers: [
      [/\b(hola|buenas|buen d[ií]a|buenos d[ií]as|qu[eé] tal|hey|saludos)\b/, '¡Hola! 👋 Los canales de al lado muestran la app. Empieza por {call}.'],
      [/gratis|pagar|pago|precio|nitro|cuesta|costo/, 'Es gratis y el código es abierto. El perfil con todo (marco, nombre con brillo) es para todos: {perfil}.'],
      [/garabat|dibuj|l[aá]ser|l[aá]piz/, 'Quien mira garabatea en la pantalla de quien transmite, y aparece en su monitor. Pruébalo en {rabiscos}.'],
      [/pantalla|transmi|stream|1440|juego|fps|calidad/, 'La pantalla va hasta 1440p a 60 fps, con el sonido del juego en estéreo y sin la voz de la llamada. Échale un vistazo en {tela-ao-vivo}.'],
      [/mapa|street|lugar/, 'Cada servidor tiene un mapa, con el cursor de todos en vivo. Está en {mapa}.'],
      [/spotify|m[uú]sica|canci[oó]n|playlist|bot/, 'El bot de Spotify suena en la llamada y cada uno lo escucha al volumen que quiera: {spotify}.'],
      [/perfil|marco|nombre|tema|banner/, 'Tema, marco, efecto y nombre con fuente y brillo, para todos: {perfil}.'],
      [/cay|ca[ií]d|internet|conex|lag|ping|trab|congel/, '¿Se cayó el internet? Si vuelve en 30 s, nadie sale de la llamada. Simúlalo en {conexao}.'],
      [/descarg|instal|windows|linux|arch|android|celular|apk|appimage|pacman/, 'Hay para Arch (.pacman), otras distros (AppImage), Windows y Android: {baixar}.'],
      [/novedad|versi[oó]n|actualiz|changelog|update/, 'Todo lo que cambió está en {novidades}, y la app se actualiza sola.'],
      [/llamada|call|voz|micr[oó]fono|habl|ruido/, 'La voz va directo de una PC a la otra, con reducción de ruido y volumen de cada uno hasta 200%: {call}.'],
    ],
    fallback: 'Todavía no sé responder eso 😅 Pero los canales de al lado lo muestran todo. Empieza por {call}.',
  },
}
