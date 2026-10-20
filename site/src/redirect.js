// Só na página em português (a raiz), dentro do <head>: na primeira visita, o site abre
// no idioma do navegador (fora dos três, inglês); depois, no que a pessoa escolheu no
// seletor (main.js guarda em `resenha.site.lang`). O #canal vai junto: a página do outro
// idioma entende o endereço em português. Robô fica aqui, cada idioma tem o seu link.
;(() => {
  let lang = null
  try {
    lang = localStorage.getItem('resenha.site.lang')
  } catch {
    // sem armazenamento (bloqueado): decide pelo navegador
  }
  if (!lang) {
    if (/bot|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent)) return
    const wanted = navigator.languages?.length ? navigator.languages : [navigator.language ?? '']
    lang = wanted.map((l) => l.slice(0, 2).toLowerCase()).find((l) => l === 'pt' || l === 'en' || l === 'es') ?? 'en'
  }
  if (lang === 'en' || lang === 'es') location.replace(`${lang}/${location.hash}`)
})()
