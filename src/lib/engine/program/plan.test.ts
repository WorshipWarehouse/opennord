import { describe, it, expect } from 'vitest';
import { planProgram, layerNote, ampEnvelope, layerGain, layerPan } from './plan';
import { soundId } from '@/lib/clavia/sound-id';
import type { NS4Layer, NS4Program } from '@/lib/ns4/types';
import type { ScanResult } from '@/lib/folder/scan';
import type { BackupRef } from '@/lib/clavia/backup/backup-index';
import type { programZones } from '@/lib/ns4/view';

const files = (): ScanResult => ({ programs: [], presets: [], pianos: [], samples: [], errors: [], backupPianos: [], backupSamples: [] });
const program = (layers: NS4Layer[]): NS4Program => ({ parsed: true, kind: 'program', layers, bytes: new Uint8Array(), warnings: [] });
const ref = (path: string): BackupRef => ({ bundlePath: 'Gig.ns4pbundle', entry: { path }, kind: 'samplib', native: false } as BackupRef);

describe('program dependency matching', () => {
  it('resolves user samples by identity even when the program has no known sample name', () => {
    const f = files(); f.backupSamples = [ref('Samp Lib/User/My Custom Pad.nsmp4')];
    const p = program([{ id: 'A', kind: 'synth', enabled: true, source: 'samples', sample: { id: soundId('My Custom Pad'), name: 'name unknown', slot: 1, bankSize: 100, categoryName: '' } }]);
    expect(planProgram(p, 'I', f)[0].source?.ref).toBe(f.backupSamples[0]);
    expect(planProgram(p, 'I', f)[0].problem).toBeUndefined();
  });
  it('does not use stale sample references on analog layers or disabled scenes', () => {
    const p = program([{ id: 'A', kind: 'synth', enabled: false, enabledSceneII: true, source: 'analog', oscType: '1 (ANALOG)', oscWave: '3 (Pure Saw)' }]);
    expect(planProgram(p, 'I', files())).toEqual([]);
    const active = planProgram(p, 'II', files());
    expect(active).toHaveLength(1);
    expect(active[0].problem).toBeUndefined();
    expect(active[0].source).toBeUndefined();
  });
  it('reports missing recordings and unsupported oscillators instead of substituting sounds', () => {
    const p = program([
      { id: 'A', kind: 'piano', enabled: true, pianoModelName: 'Missing Grand XL' },
      { id: 'A', kind: 'synth', enabled: true, source: 'analog', oscType: '4 (WAVE)', oscWave: 'Bell' },
    ]);
    const plan = planProgram(p, 'I', files());
    expect(plan[0].problem).toContain('Missing piano');
    expect(plan[1].problem).toContain('Unsupported synth');
  });
});

describe('program note routing', () => {
  const l: NS4Layer = { id: 'A', kind: 'piano', octaveShift: 1 };
  const zones = { hasSplit: true, boundaries: ['C4', null, null], transpose: '+2', zones: [
    { layers: [{ kind: 'piano', id: 'A' }] }, { layers: [] }, { layers: [] }, { layers: [] },
  ] } as unknown as ReturnType<typeof programZones>;
  it('tests physical split keys before applying program transpose and octave shifts', () => {
    expect(layerNote(l, zones, 59)).toBe(73);
    expect(layerNote(l, zones, 60)).toBeNull();
    expect(layerNote(l, { ...zones, hasSplit: false }, 60)).toBe(74);
    expect(layerNote(l, { ...zones, hasSplit: false }, 127)).toBeNull();
  });
  it('merges zones across inactive boundaries', () => {
    const z = { ...zones, boundaries: [null, 'C5', null] };
    expect(layerNote(l, z, 71)).toBe(85);
    expect(layerNote(l, z, 72)).toBeNull();
  });
  it('parses levels, pan, and authored envelope units', () => {
    expect(layerGain({ ...l, volume: { value: '-6.0 dB' } })).toBeCloseTo(0.501, 3);
    expect(layerGain({ ...l, volume: { value: '-inf dB' } })).toBe(0);
    expect(layerPan({ ...l, pan: { value: 'L  4.7' } })).toBeCloseTo(-0.47);
    expect(ampEnvelope({ ...l, ampEnv: { attack: '505 ms', decay: 'inf', release: '2.85 s' } })).toEqual({ attack: 0.505, decay: 0, sustain: 1, release: 2.85 });
  });
});
