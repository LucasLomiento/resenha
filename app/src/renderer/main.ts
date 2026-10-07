// Fontes empacotadas no app (o CSP só deixa carregar fonte do próprio app).
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
// Fontes do nome com estilo (personalização do perfil), todas OFL.
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/fredoka/wght.css'
import '@fontsource/pacifico/latin-400.css'
import '@fontsource/pacifico/latin-ext-400.css'
import '@fontsource/silkscreen/latin-400.css'
import '@fontsource/silkscreen/latin-ext-400.css'
import { mount } from 'svelte'
import './app.css'
import App from './ui/App.svelte'

mount(App, { target: document.getElementById('app')! })
