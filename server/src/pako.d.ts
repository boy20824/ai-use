// Minimal public surface used by the bounded, browser-compatible ZIP reader.
declare module 'pako' {
  export class Inflate {
    constructor(options: { raw: boolean; chunkSize: number })
    onData(chunk: Uint8Array): void
    push(data: Uint8Array, final: boolean): boolean
    err: number
    ended: boolean
    strm: { avail_in: number }
  }
}
