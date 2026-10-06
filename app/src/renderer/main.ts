// Fontes empacotadas no app (o CSP só deixa carregar fonte do próprio app).
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { mount } from 'svelte'
import './app.css'
import App from './ui/App.svelte'

mount(App, { target: document.getElementById('app')! })
