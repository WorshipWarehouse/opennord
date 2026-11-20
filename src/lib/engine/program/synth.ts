/** Independent Web Audio sketch of basic analog families, not Nord oscillator DSP. */
import type { NS4Layer } from '@/lib/ns4/types';
import { ampEnvelope, numberIn, seconds } from './plan';

export interface ProgramVoice {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  dispose(): void;
}

export function analogShape(wave: string): OscillatorType {
  if (/Triangle/.test(wave)) return 'triangle';
  if (/Saw/.test(wave)) return 'sawtooth';
  if (/Square|Pulse/.test(wave)) return 'square';
  return 'sine';
}

export function createAnalogVoice(ctx: AudioContext, layer: NS4Layer, output: AudioNode): ProgramVoice {
  type Note = { oscillators: OscillatorNode[]; gain: GainNode; filters: BiquadFilterNode[]; started: number; peak: number; released?: number };
  const held = new Map<number, Note>();
  const all = new Set<Note>();
  const env = ampEnvelope(layer);
  let disposed = false;

  function levelAt(v: Note, t: number): number {
    const dt = Math.max(0, t - v.started);
    if (dt < env.attack) return v.peak * dt / env.attack;
    return v.peak * (env.decay ? Math.max(0, 1 - (dt - env.attack) / env.decay) : 1);
  }
  function release(v: Note, fast = false) {
    const now = ctx.currentTime;
    const end = now + (fast ? 0.01 : env.release);
    if (v.released !== undefined && v.released <= end) return;
    v.released = end;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(levelAt(v, now), now);
    v.gain.gain.linearRampToValueAtTime(0, end);
    for (const o of v.oscillators) { try { o.stop(end + 0.01); } catch { /* already stopped */ } }
  }
  const voice: ProgramVoice = {
    noteOn(note, velocity) {
      if (disposed) return;
      if (layer.mono) { for (const v of held.values()) release(v, true); held.clear(); }
      const old = held.get(note);
      if (old) release(old, true);
      if (all.size >= 32) {
        const oldest = all.values().next().value!;
        for (const o of oldest.oscillators) { try { o.stop(); } catch { /* ended */ } }
        all.delete(oldest);
        for (const [key, v] of held) if (v === oldest) held.delete(key);
      }
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const velocityAmount = Math.max(0, Math.min(1, numberIn(layer.ampEnv?.velocity) / 3));
      const peak = 0.2 * ((1 - velocityAmount) + velocityAmount * velocity / 127);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + env.attack);
      if (env.decay) gain.gain.linearRampToValueAtTime(0, now + env.attack + env.decay);
      gain.connect(output);
      const v: Note = { oscillators: [], gain, filters: [], started: now, peak };
      let input: AudioNode = gain;
      const f = layer.filter;
      if (f?.on) {
        const base = Math.min(ctx.sampleRate * 0.45, numberIn(f.freq?.value, 20000) * (f.freq?.value.includes('kHz') ? 1000 : 1));
        const track = f.track === '2/3' ? 2 / 3 : f.track === '1/3' ? 1 / 3 : f.track === '1' ? 1 : 0;
        const cutoff = Math.min(ctx.sampleRate * 0.45, base * 2 ** ((note - 60) * track / 12));
        for (let i = 0; i < (f.type === 'LP24' ? 2 : 1); i++) {
          const filter = ctx.createBiquadFilter();
          filter.type = f.type === 'BP' ? 'bandpass' : f.type === 'HP' ? 'highpass' : 'lowpass';
          filter.Q.value = Math.max(0.01, Math.min(12, numberIn(f.resonance?.value)));
          filter.frequency.setValueAtTime(Math.max(20, cutoff), now);
          const amount = numberIn(f.envAmount?.value);
          if (amount) {
            const end = Math.max(20, Math.min(ctx.sampleRate * 0.45, cutoff * 2 ** amount));
            const attack = seconds(f.env?.attack, 0.005);
            filter.frequency.exponentialRampToValueAtTime(end, now + attack);
            if (f.env?.decay !== 'inf') filter.frequency.exponentialRampToValueAtTime(Math.max(20, cutoff), now + attack + seconds(f.env?.decay, 1));
          }
          filter.connect(input); input = filter; v.filters.push(filter);
        }
      }
      const wave = layer.oscWave ?? '';
      const count = /Super|Multi/.test(wave) ? 5 : Number(layer.unison) > 0 ? 3 : 1;
      const cents = numberIn(layer.pitchFine);
      const coarse = numberIn(layer.pitchCoarse);
      const ended = new Set<OscillatorNode>();
      for (let i = 0; i < count + (/Sub /.test(wave) ? 1 : 0); i++) {
        const o = ctx.createOscillator();
        const sub = i === count;
        o.type = sub ? 'sine' : analogShape(wave);
        o.frequency.value = 440 * 2 ** ((note + coarse - 69 - (sub ? 12 : 0)) / 12);
        o.detune.value = cents + (sub ? 0 : (i - (count - 1) / 2) * 6);
        const level = ctx.createGain(); level.gain.value = sub ? 0.4 : 1 / Math.sqrt(count);
        o.connect(level).connect(input);
        o.onended = () => {
          o.disconnect(); level.disconnect();
          if (v.oscillators.every(x => ended.has(x))) {
            all.delete(v); if (held.get(note) === v) held.delete(note);
            gain.disconnect(); for (const filter of v.filters) filter.disconnect();
          }
        };
        // Track individual end events before the common cleanup.
        const cleanup = o.onended;
        o.onended = e => { ended.add(o); cleanup?.call(o, e); };
        v.oscillators.push(o); o.start();
        if (env.decay) o.stop(now + env.attack + env.decay + 0.02);
      }
      held.set(note, v); all.add(v);
    },
    noteOff(note) { const v = held.get(note); if (v) { held.delete(note); release(v); } },
    dispose() { disposed = true; for (const v of all) release(v, true); held.clear(); },
  };
  return voice;
}
