// Tipos do build síncrono do RNNoise (o pacote não traz .d.ts).
declare module '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js' {
  interface RnnoiseModule {
    HEAPF32: Float32Array
    _rnnoise_create(): number
    _rnnoise_destroy(state: number): void
    /** Devolve a probabilidade de ter voz no bloco (0..1). */
    _rnnoise_process_frame(state: number, output: number, input: number): number
    _malloc(bytes: number): number
    _free(pointer: number): void
  }
  const createRnnoise: () => RnnoiseModule
  export default createRnnoise
}
