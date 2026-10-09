import type pt from '../pt/kit'

export default {
  colorPicker: {
    label: 'Color',
    area: 'Saturation and brightness',
    hue: 'Hue',
    code: 'Color code',
  },
  meter: {
    label: 'Microphone level',
    threshold: 'Sensitivity',
  },
  signal: {
    measuring: 'Measuring connection…',
    relay: (rtt: number) => `${rtt} ms · through the server (relay)`,
    direct: (rtt: number) => `${rtt} ms · direct connection`,
  },
  badge: {
    founder: 'Resenha founder',
    pioneer: "Best friend of Resenha's owner, the most badass dude I've ever met. Sometimes way too pissed off, sometimes way too much of a bitch.",
  },
} satisfies typeof pt
