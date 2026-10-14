// App de Android do Resenha: a interface do app (build em www, gerado por
// `npm -w app run build:mobile`) dentro do Capacitor. Ver docs/ARQUITETURA.md ("Celular").
import type { CapacitorConfig } from '@capacitor/cli'

/** Build de teste (app/test/android.mjs): depurável e falando com o servidor local em http. */
const debug = process.env.RESENHA_ANDROID_DEBUG === '1'

const config: CapacitorConfig = {
  // O mesmo id do app de computador.
  appId: 'com.lucasreis.resenha',
  appName: 'Resenha',
  webDir: 'www',
  // A página roda em https://localhost (o servidor aceita qualquer origem).
  server: { androidScheme: 'https', cleartext: debug },
  // A cor da janela do app aparece atrás das barras do sistema.
  backgroundColor: '#09090b',
  android: {
    // Depurar a interface pelo chrome://inspect só no build de teste.
    webContentsDebuggingEnabled: debug,
    allowMixedContent: debug,
  },
  plugins: {
    // A interface fica entre a barra de status e a de navegação (sem desenhar por trás delas).
    SystemBars: { insetsHandling: 'native', style: 'DARK' },
    LocalNotifications: { smallIcon: 'ic_stat_resenha', iconColor: '#2b6cf5' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Keyboard: { resize: 'native' },
  },
}

export default config
