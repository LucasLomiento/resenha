// Onde os anexos ficam guardados.
//
// Por enquanto, dentro do próprio SQLite do Durable Object, em pedaços de
// 1 MB (uma linha do SQLite do DO aceita no máximo 2 MB). Não precisa ativar
// nada no Cloudflare. Pra trocar por outro serviço (Supabase Storage, R2...)
// é escrever outra classe com os mesmos três métodos: put, read e delete.

export const CHUNK_BYTES = 1024 * 1024

export class FileTooLarge extends Error {}

export class SqlFileStore {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS file_chunks (
      file_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (file_id, seq)
    )`)
  }

  /** Lê o corpo da requisição em pedaços e grava; devolve o tamanho final. */
  async put(id: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
    const reader = body.getReader()
    const buffer = new Uint8Array(CHUNK_BYTES)
    let filled = 0
    let seq = 0
    let total = 0
    const flush = () => {
      if (filled === 0) return
      this.sql.exec('INSERT INTO file_chunks (file_id, seq, data) VALUES (?, ?, ?)', id, seq++, buffer.slice(0, filled).buffer)
      filled = 0
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) throw new FileTooLarge()
        let offset = 0
        while (offset < value.byteLength) {
          const take = Math.min(CHUNK_BYTES - filled, value.byteLength - offset)
          buffer.set(value.subarray(offset, offset + take), filled)
          filled += take
          offset += take
          if (filled === CHUNK_BYTES) flush()
        }
      }
      flush()
      return total
    } catch (err) {
      // Envio cancelado ou grande demais: não deixa pedaço órfão.
      this.delete([id])
      reader.cancel().catch(() => {})
      throw err
    }
  }

  /** Stream dos bytes [start, end] (inclusive), buscando um pedaço de cada vez. */
  read(id: string, start: number, end: number): ReadableStream<Uint8Array> {
    let position = start
    return new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (position > end) return controller.close()
        const seq = Math.floor(position / CHUNK_BYTES)
        const row = this.sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM file_chunks WHERE file_id = ? AND seq = ?', id, seq)
          .toArray()[0]
        if (!row) return controller.error(new Error(`pedaço ${seq} do arquivo ${id} sumiu`))
        const offset = position - seq * CHUNK_BYTES
        const take = Math.min(row.data.byteLength - offset, end - position + 1)
        controller.enqueue(new Uint8Array(row.data, offset, take))
        position += take
      },
    })
  }

  delete(ids: string[]) {
    if (ids.length === 0) return
    // Um parâmetro só (JSON): o SQLite do DO aceita poucos parâmetros por consulta.
    this.sql.exec('DELETE FROM file_chunks WHERE file_id IN (SELECT value FROM json_each(?))', JSON.stringify(ids))
  }
}
