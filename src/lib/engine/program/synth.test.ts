import { it, expect, vi } from 'vitest';
import { analogShape, createAnalogVoice } from './synth';

function audio() {
  const oscillators: ReturnType<typeof osc>[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const osc = () => ({ type: '', frequency: param(), detune: param(), connect: (to: unknown) => to, disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as ((e: Event) => void) | null });
  const gains: ReturnType<typeof gain>[] = [];
  const gain = () => ({ gain: param(), connect: (to: unknown) => to, disconnect: vi.fn() });
  const ctx = { currentTime: 0, sampleRate: 44100,
    createOscillator: () => { const o = osc(); oscillators.push(o); return o; },
    createGain: () => { const g = gain(); gains.push(g); return g; },
  } as unknown as AudioContext;
  return { ctx, oscillators, gains };
}
it('uses the actual source family and authored pitch rather than a stale sample reference', () => {
  expect(analogShape('3 (Pure Saw)')).toBe('sawtooth');
  expect(analogShape('2 (Pure Triangle)')).toBe('triangle');
  const { ctx, oscillators, gains } = audio();
  const v = createAnalogVoice(ctx, { id: 'A', oscWave: '1 (Pure Sine)', pitchCoarse: '+12 semi', pitchFine: '- 7 cent', ampEnv: { attack: '505 ms', decay: 'inf', release: '2 s' } }, {} as AudioNode);
  v.noteOn(57, 100);
  expect(oscillators[0].frequency.value).toBe(440);
  expect(oscillators[0].detune.value).toBe(-7);
  expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 0.505);
  v.noteOff(57);
  expect(oscillators[0].stop).toHaveBeenCalledWith(2.01);
  v.dispose(); v.noteOn(60, 100);
  expect(oscillators).toHaveLength(1);
});
it('cleans the shared note graph after every unison oscillator ends', () => {
  const { ctx, oscillators, gains } = audio();
  const v = createAnalogVoice(ctx, { id: 'A', oscWave: '1 (Super Saw)' }, {} as AudioNode);
  v.noteOn(60, 100); v.noteOff(60);
  expect(oscillators).toHaveLength(5);
  oscillators[0].onended!(new Event('ended'));
  expect(gains[0].disconnect).not.toHaveBeenCalled();
  for (const o of oscillators.slice(1)) o.onended!(new Event('ended'));
  expect(gains[0].disconnect).toHaveBeenCalledOnce();
  v.dispose();
});
it('bounds analog polyphony and stops retriggered notes', () => {
  const { ctx, oscillators } = audio();
  const v = createAnalogVoice(ctx, { id: 'A', oscWave: '1 (Pure Sine)' }, {} as AudioNode);
  v.noteOn(60, 100); v.noteOn(60, 100);
  expect(oscillators[0].stop).toHaveBeenCalled();
  for (let n = 0; n < 50; n++) v.noteOn(n, 80);
  expect(oscillators.filter(o => !o.stop.mock.calls.length).length).toBeLessThanOrEqual(32);
  v.dispose();
  expect(oscillators.every(o => o.stop.mock.calls.length > 0)).toBe(true);
});
