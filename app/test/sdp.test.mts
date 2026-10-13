import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioMidsOf, candidateFamily, ipFamily, keepFamily, tuneScreenOpus } from '../src/renderer/lib/sdp.ts'

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

// ---------- Família de IP dos candidatos (rota por IPv4 ou IPv6) ----------

const V4 = 'candidate:1 1 udp 2122260223 192.168.1.15 50000 typ host generation 0'
const V6 = 'candidate:2 1 udp 2122262783 2804:d57:1:2::5 50001 typ host generation 0'
const SRFLX = 'candidate:3 1 udp 1686052607 177.10.20.30 50002 typ srflx raddr 192.168.1.15 rport 50000'
const MDNS = 'candidate:4 1 udp 2122260223 6f1c2c7e-1111-2222-3333-444455556666.local 50003 typ host'

test('reconhece a família de cada candidato (o .local não tem família)', () => {
  assert.equal(candidateFamily(V4), 'ipv4')
  assert.equal(candidateFamily(`a=${V6}`), 'ipv6')
  assert.equal(candidateFamily(SRFLX), 'ipv4')
  assert.equal(candidateFamily(MDNS), null)
  assert.equal(ipFamily(''), null)
})

test('presa no IPv4: os candidatos IPv6 saem do SDP e o resto fica igual', () => {
  const sdp = [OFFER.trimEnd(), `a=${V4}`, `a=${V6}`, `a=${SRFLX}`, `a=${MDNS}`, ''].join('\r\n')
  const kept = keepFamily(sdp, 'ipv4')
  assert.ok(!kept.includes('2804:d57'))
  for (const line of [V4, SRFLX, MDNS]) assert.ok(kept.includes(line))
  assert.ok(kept.startsWith(OFFER.trimEnd()))
  assert.ok(keepFamily(sdp, 'ipv6').includes(V6) && !keepFamily(sdp, 'ipv6').includes('192.168.1.15 50000 typ host'))
})
