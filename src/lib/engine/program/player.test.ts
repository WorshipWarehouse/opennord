import { it, expect, vi, beforeEach } from 'vitest';
import type { NS4Program, NS4Layer } from '@/lib/ns4/types';
import type { PlannedLayer } from './plan';
const mocks = vi.hoisted(() => {
  const voices: { noteOn: ReturnType<typeof vi.fn>; noteOff: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const create = () => { const v = { noteOn: vi.fn(), noteOff: vi.fn(), dispose: vi.fn() }; voices.push(v); return v; };
  return { voices, create, organ: vi.fn(async () => create()) };
});
vi.mock('@/lib/engine/organ/organ-voice', () => ({ createOrganVoice: mocks.organ }));
vi.mock('./synth', () => ({ createAnalogVoice: mocks.create }));
vi.mock('@/lib/ns4/view', () => ({ programZones: () => ({ hasSplit: false, transpose: '+2' }), vibChorusTypeFor: () => 'C3' }));
import { createProgramPlayer } from './player';

function audio() {
  const nodes: { disconnect: ReturnType<typeof vi.fn> }[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn() });
  const node = () => { const n = { gain: param(), pan: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect: (to: unknown) => to, disconnect: vi.fn() }; nodes.push(n); return n; };
  return { nodes, ctx: { currentTime: 0, destination: {}, createGain: node, createStereoPanner: node, createDynamicsCompressor: node } as unknown as AudioContext };
}
const layer: NS4Layer = { id: 'A', kind: 'synth', source: 'analog', octaveShift: 1 };
const program = { parsed: true, kind: 'program', bytes: new Uint8Array(), warnings: [] } as NS4Program;
beforeEach(() => { mocks.voices.length = 0; mocks.organ.mockReset().mockImplementation(async () => mocks.create()); });

it('fans notes out to every playable layer and releases the same transposed notes', async () => {
  const { ctx } = audio();
  const plan: PlannedLayer[] = [{ layer }, { layer: { ...layer, id: 'B', octaveShift: -1 } }];
  const p = await createProgramPlayer(ctx, program, 'I', plan, vi.fn(), () => false, vi.fn());
  p.noteOn(60, 85);
  expect(mocks.voices[0].noteOn).toHaveBeenCalledWith(74, 85);
  expect(mocks.voices[1].noteOn).toHaveBeenCalledWith(50, 85);
  p.noteOff(60);
  expect(mocks.voices[0].noteOff).toHaveBeenCalledWith(74);
  expect(mocks.voices[1].noteOff).toHaveBeenCalledWith(50);
  p.dispose();
  expect(mocks.voices.every(v => v.dispose.mock.calls.length === 1)).toBe(true);
  p.noteOn(60, 90);
  expect(mocks.voices[0].noteOn).toHaveBeenCalledTimes(1);
});
it('disposes a late asynchronous voice when loading is cancelled', async () => {
  const { ctx, nodes } = audio();
  let finish!: (v: ReturnType<typeof mocks.create>) => void;
  mocks.organ.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let cancel = false;
  const pending = createProgramPlayer(ctx, program, 'I', [{ layer: { id: 'A', kind: 'organ' } }], vi.fn(), () => cancel, vi.fn());
  cancel = true;
  const voice = mocks.create(); finish(voice);
  await pending;
  expect(voice.dispose).toHaveBeenCalledOnce();
  expect(nodes.every(n => n.disconnect.mock.calls.length === 1)).toBe(true);
});
it('reports a failed layer while keeping other layers playable', async () => {
  const { ctx } = audio();
  const p = await createProgramPlayer(ctx, program, 'I', [
    { layer: { id: 'A', kind: 'piano' }, source: { key: 'x', name: 'x' } },
    { layer },
    { layer: { ...layer, id: 'C' }, problem: 'Unsupported WAVE' },
  ], async () => { throw new Error('Folder permission lost'); }, () => false, vi.fn());
  expect(p.layers).toEqual(['synth A']);
  expect(p.problems).toEqual(['piano A: Folder permission lost', 'synth C: Unsupported WAVE']);
  p.noteOn(60, 100); expect(mocks.voices[0].noteOn).toHaveBeenCalledOnce(); p.dispose();
});
