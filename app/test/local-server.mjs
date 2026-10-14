// Servidor do Resenha só pra teste: `wrangler dev --local` numa porta própria, com os dados
// numa pasta temporária (apagada no fim). Usado pelo e2e e pelo teste no Android.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function startServer(port) {
  const SERVER = `http://127.0.0.1:${port}`
  const state = mkdtempSync(join(tmpdir(), 'resenha-e2e-server-'))
  let proc = null
  let log = ''
  const up = async () => {
    proc = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state], {
      cwd: new URL('../../server', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    proc.stdout.on('data', (d) => (log += d))
    proc.stderr.on('data', (d) => (log += d))
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${SERVER}/api/status`)).ok) return
      } catch {
        // ainda subindo
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    process.kill(-proc.pid, 'SIGTERM')
    throw new Error(`servidor de teste não subiu:\n${log.slice(-2000)}`)
  }
  const down = async () => {
    const exited = new Promise((r) => proc.once('exit', r))
    process.kill(-proc.pid, 'SIGTERM')
    await exited
    // Espera a porta soltar (o workerd sai logo depois do wrangler).
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${SERVER}/api/status`)
      } catch {
        return
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  await up()
  return {
    /** Reinicia com os mesmos dados (como um deploy ou o Cloudflare reiniciando o Durable Object). */
    restart: async () => {
      await down()
      await up()
    },
    stop: () => (process.kill(-proc.pid, 'SIGTERM'), rmSync(state, { recursive: true, force: true })),
  }
}
