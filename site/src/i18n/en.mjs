// Textos do site em inglês. Mesmas chaves do pt.mjs (as regras estão lá).

export default {
  meta: {
    description:
      'Voice, chat and screen sharing up to 1440p at 60 fps for your group, straight from one PC to the other. Doodle on your friend’s screen, share a map, play Spotify in the call and make your profile your own.',
    ogDescription: 'Your crew’s call: voice, chat and screen sharing, straight from one PC to the other.',
  },

  channels: {
    'boas-vindas': 'welcome',
    baixar: 'download',
    call: 'call',
    'tela-ao-vivo': 'screen-share',
    rabiscos: 'doodles',
    mapa: 'map',
    perfil: 'profile',
    spotify: 'spotify',
    conexao: 'connection',
    novidades: 'whats-new',
  },

  common: {
    skip: 'Skip to content',
    live: 'LIVE',
    bot: 'app',
    you: 'You',
    now: 'now',
  },

  rail: {
    label: 'Shortcuts',
    home: 'Home',
    server: 'Resenha server',
    download: 'Download',
    code: 'Code on GitHub',
  },

  side: {
    label: 'Channels',
    close: 'Close the channels',
    start: 'Start here',
    app: 'Meet the app',
    project: 'Project',
    code: 'code',
  },

  dock: {
    inCall: 'In call',
    leave: 'Leave call',
    visitor: 'visitor',
    mute: 'Mute',
    deafen: 'Deafen',
  },

  head: {
    channels: 'Channels',
    prev: 'Previous channel',
    next: 'Next channel',
    download: 'Download',
    language: 'Language',
  },

  welcome: {
    topic: 'Start here: what Resenha is and how to get around this site.',
    live: 'Live',
    version: 'version {{VERSION}}',
    title: 'Your crew’s call.',
    lede: 'Voice, chat and screen sharing for your group, straight from one PC to the other. Stream up to 1440p at 60 fps with game audio, doodle on your friend’s screen, share a map and play Spotify in the call.',
    download: 'Download Resenha',
    tour: 'Take the tour',
    today: 'Today',
    hello:
      'This is a make-believe Resenha. 👋 The channels on the left are parts of the app: click any of them, or use the arrows up top to go one by one.',
    bia: "call tonight? i miss you all <span class='mention'>@everyone</span>",
    ask: 'Ask me something down here (screen, doodles, map, Spotify, download...).',
    placeholder: 'Message #{{channels.boas-vindas}}',
    message: 'Message',
    send: 'Send',
  },

  call: {
    topic: 'Voice straight from one PC to the other, no server in the middle.',
    title: 'Hop in, talk.',
    text: 'Voice goes straight from one PC to the other. Noise suppression, voice detection, everyone’s volume up to 200% and the best route (IPv4 or IPv6) picked for you.',
    muted: 'muted',
  },

  screen: {
    topic: 'Screen sharing: up to 1440p at 60 fps, with game audio.',
    title: '1440p, 60 fps and the game audio.',
    text: 'Share your monitor or a window. Audio goes in stereo and the call’s voices stay out: nobody hears themselves twice. Pick a quality and see what changes:',
    quality: 'Quality',
    q720: 'Lighter',
    q1080: 'Full HD',
    q1440: 'Max',
  },

  ink: {
    topic: 'Viewers draw on top, and it shows up on the streamer’s monitor.',
    title: 'Doodle on your friend’s screen.',
    text: 'Drag your mouse (or finger) over the screen. Laser to point, pen to mark: in the app, it shows up on the monitor of whoever is streaming.',
    tool: 'Tool',
    laser: 'Laser',
    pen: 'Pen',
    clear: 'Clear',
    hint: 'Draw here',
  },

  map: {
    topic: 'One map per server: drag it and everyone comes along.',
    title: 'Everyone on the same map.',
    text: 'Live cursors, markers saved on the server and Street View. Click the map to mark a spot.',
    pin: 'Pizza place',
    moving: 'Gabi is moving the map',
  },

  profile: {
    topic: 'Banner, animated avatar, frame, effect and a styled name. For everyone.',
    title: 'Your profile, your way.',
    text: 'Card theme, frame, effect and a name with its own font and glow. For everyone, no paying. Try it:',
    pronouns: 'she/her',
    bio: 'Thursday RPG game master. Don’t call me before 10.',
    theme: 'Card theme',
    themes: { ocean: 'Ocean', sunset: 'Sunset', forest: 'Forest', candy: 'Cotton candy', ember: 'Ember' },
    frame: 'Frame',
    frames: { none: 'None', neon: 'Neon', aurora: 'Aurora', gold: 'Crown' },
    name: 'Name',
    names: { plain: 'Classic', gradient: 'Gradient', neon: 'Neon' },
  },

  spotify: {
    topic: 'The Spotify bot plays in the call, and everyone listens at their own volume.',
    title: 'The call’s soundtrack.',
    text: 'Put your Spotify in the call: it plays for everyone in the room, and anyone can skip, search and queue. Click a song:',
    prev: 'Previous',
    next: 'Next',
  },

  drop: {
    topic: 'The call survives your internet dropping, and the app updates itself.',
    title: 'Internet dropped? The call goes on.',
    text: 'Back within 30 seconds, nobody leaves the room and the stream keeps playing. Try it:',
    offline: 'No connection. Retrying…',
    back: 'Back. Nobody left the call.',
    frame: 'frame',
    button: 'Drop the internet',
  },

  updates: {
    topic: '{{COUNT}} versions since {{FIRST_DATE}}. The app lets you know when the next one is out.',
    title: 'Welcome to #{{channels.novidades}}',
    text: 'Everything that changed in Resenha, from newest to oldest.',
    older: 'Earlier versions',
    newest: 'newest',
    original: 'in Portuguese',
  },

  download: {
    topic: 'Version {{VERSION}}, from {{VERSION_DATE}}. Once installed, it updates itself.',
    title: 'Download Resenha',
    button: 'Download',
    copy: 'Copy the command',
    arch: { os: 'Arch, CachyOS, Omarchy', kind: '.pacman package' },
    linux: { os: 'Other Linux distros', kind: 'AppImage' },
    windows: {
      os: 'Windows 10 and 11',
      kind: 'Installer',
      alt: "Or the <a href='{{ZIP_URL}}'>.zip</a>, no install needed (that one doesn’t update itself).",
    },
    android: {
      os: 'Android 7 or newer',
      kind: 'Phone app (.apk)',
      alt: 'Not on the Play Store: the first time, Android asks you to allow the install. The app lets you know when a new version is out.',
    },
    account: 'To get in you need an account: with an invite from someone in the group, or directly, when sign-ups are open.',
  },

  foot: {
    made: 'Made by friends, for friends. Open source.',
    links: 'Links',
    code: 'Code',
    privacy: 'Privacy (in Portuguese)',
    terms: 'Terms (in Portuguese)',
  },

  js: {
    next: 'Next',
    startTour: 'Start the tour',
    mute: 'Mute',
    unmute: 'Unmute',
    deafen: 'Deafen',
    undeafen: 'Undeafen',
    inCall: 'in call',
    visitor: 'visitor',
    join: 'Join the call',
    leave: 'Leave call',
    noteOut: 'The others are already in. The green ring shows who’s talking.',
    noteIn: 'You’re in. The mic and headphones down there, next to your name, work here too.',
    noteMuted: 'You’re muted. Unmute with the mic down there, next to your name.',
    inkYou: 'you',
    pins: ['Here!', 'You in?', 'Meetup', 'Snacks', 'Hangout'],
    genres: [['sertanejo', 'romantic'], ['pop'], ['brazilian rock'], ['bossa nova', 'mpb']],
    play: 'Play',
    pause: 'Pause',
    you: 'You',
    now: 'now',
    typing: '<b>Resenha</b> is typing…',
    copy: 'Copy the command',
    copied: 'Copied',
    cta: { windows: 'Download for Windows', android: 'Download for Android', linux: 'Download for Linux' },
    answers: [
      [/\b(hi|hello|hey|hiya|yo|sup|howdy|good (morning|afternoon|evening))\b/, 'Hey! 👋 The channels on the side show off the app. Start with {call}.'],
      [/\bfree\b|pay|price|nitro|cost/, 'It’s free and open source. The fancy profile (frame, glowing name) is for everyone: {perfil}.'],
      [/doodl|draw|laser|\bpen\b|sketch/, 'Viewers doodle on the streamer’s screen, and it shows up on their monitor. Try it in {rabiscos}.'],
      [/screen|stream|1440|game|fps|quality/, 'Screen sharing goes up to 1440p at 60 fps, with game audio in stereo and without the call’s voices. Check out {tela-ao-vivo}.'],
      [/\bmaps?\b|street|place/, 'Every server has a map, with everyone’s cursor live. It’s in {mapa}.'],
      [/spotify|music|song|playlist|bot/, 'The Spotify bot plays in the call and everyone listens at their own volume: {spotify}.'],
      [/profile|frame|name|theme|banner|avatar/, 'Theme, frame, effect and a name with its own font and glow, for everyone: {perfil}.'],
      [/drop|disconnect|internet|connection|lag|ping|froze|freez/, 'Internet dropped? If it’s back within 30 s, nobody leaves the call. Simulate it in {conexao}.'],
      [/download|install|windows|linux|arch|android|phone|apk|appimage|pacman|\bmac/, 'There’s Arch (.pacman), other distros (AppImage), Windows and Android: {baixar}.'],
      [/\bnew\b|version|update|changelog|release/, 'Everything that changed is in {novidades}, and the app updates itself.'],
      [/call|voice|\bmic|talk|noise/, 'Voice goes straight from one PC to the other, with noise suppression and everyone’s volume up to 200%: {call}.'],
    ],
    fallback: 'I don’t know how to answer that yet 😅 But the channels on the side show everything. Start with {call}.',
  },
}
