import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioMidsOf, tuneScreenOpus } from '../src/renderer/lib/sdp.ts'

// Oferta de quem compartilha: voz (mid 0), vídeo da tela (mid 1) e áudio da tela (mid 2).
const OFFER = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1 2',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:0',
  'a=msid:mic-stream mic-track',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=msid:screen-stream screen-video',
  'a=rtpmap:96 VP9/90000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:2',
  'a=msid:screen-stream screen-audio',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  '',
].join('\r\n')

test('acha só o áudio do stream da tela (a voz e o vídeo ficam de fora)', () => {
  assert.deepEqual([...audioMidsOf(OFFER, (id) => id === 'screen-stream')], ['2'])
  assert.deepEqual([...audioMidsOf(OFFER, (id) => id === 'nada')], [])
})

test('estéreo e bitrate maior só na seção do áudio da tela', () => {
  const tuned = tuneScreenOpus(OFFER, new Set(['2']))
  const sections = tuned.split(/(?=\r\nm=)/)
  assert.match(sections[3], /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000/)
  // A voz continua como o Opus manda.
  assert.match(sections[1], /a=fmtp:111 minptime=10;useinbandfec=1$/)
  assert.doesNotMatch(sections[1], /stereo/)
})

test('sem áudio de tela, a descrição sai igualzinha', () => {
  assert.equal(tuneScreenOpus(OFFER, new Set()), OFFER)
})
