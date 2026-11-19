import type { NS4Layer, NS4Program } from '@/lib/ns4/types';
import { activeLayers, programZones } from '@/lib/ns4/view';
import { soundId } from '@/lib/clavia/sound-id';
import type { ScanResult } from '@/lib/folder/scan';
import type { BackupRef } from '@/lib/clavia/backup/backup-index';
import { findProgramPiano, localPianos } from '@/lib/library/piano-match';
import { noteToMidi } from '@/components/program/zone-map';
import type { AmpEnvelope } from '@/components/sample/sampleEngine';

export interface SoundSource { key: string; name: string; bytes?: Uint8Array; ref?: BackupRef }
export interface PlannedLayer { layer: NS4Layer; source?: SoundSource; problem?: string }
const stem = (s: string) => (s.split('/').pop() ?? s).replace(/\.[^.]+$/, '');
const pianoId = (s: string) => soundId(stem(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim());

/** Identity first, conservative piano-name fallback second. No slot-based guessing. */
export function planProgram(program: NS4Program, scene: 'I' | 'II', files: ScanResult): PlannedLayer[] {
  const pianos: SoundSource[] = [
    ...files.pianos.map(p => ({ key: p.id, name: p.name, bytes: p.bytes })),
    ...files.backupPianos.map(ref => ({ key: `${ref.bundlePath}!${ref.entry.path}`, name: ref.entry.path, ref })),
  ];
  const samples: SoundSource[] = [
    ...files.samples.map(s => ({ key: s.id, name: s.path, bytes: s.bytes })),
    ...files.backupSamples.map(ref => ({ key: `${ref.bundlePath}!${ref.entry.path}`, name: ref.entry.path, ref })),
  ];
  return activeLayers(program, scene).map(layer => {
    if (layer.kind === 'organ') return { layer };
    if (layer.kind === 'piano') {
      let source = pianos.find(s => pianoId(s.name) === layer.pianoModelId);
      if (!source) {
        const match = findProgramPiano(layer.pianoModelName ?? '', localPianos(files));
        if (match) source = { key: match.piano.id, name: match.piano.name, bytes: match.piano.bytes, ref: match.piano.backupRef };
      }
      return { layer, source, problem: source ? undefined : `Missing piano: ${layer.pianoModelName ?? layer.pianoModelId}` };
    }
    if (layer.source === 'samples') {
      const source = samples.find(s => soundId(stem(s.name)) === layer.sample?.id);
      return { layer, source, problem: source ? undefined : `Missing sample: ${layer.sample?.name === 'name unknown' ? layer.sample.id : layer.sample?.name ?? 'unknown'}` };
    }
    const supported = layer.oscType?.includes('(ANALOG)') && /Sine|Saw|Triangle|Square|Pulse/.test(layer.oscWave ?? '');
    return { layer, problem: supported ? undefined : `Unsupported synth: ${layer.oscType ?? 'unknown'} · ${layer.oscWave ?? 'unknown'}` };
  });
}

export function numberIn(s: string | undefined, fallback = 0): number {
  const n = Number.parseFloat((s ?? '').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
export function layerGain(layer: NS4Layer): number {
  return /inf|off|oo|∞/i.test(layer.volume?.value ?? '') ? 0 : 10 ** (Math.min(0, numberIn(layer.volume?.value)) / 20);
}
export function layerPan(layer: NS4Layer): number {
  const p = layer.pan?.value ?? '';
  return Math.max(-1, Math.min(1, numberIn(p.replace(/^[LR]\s*/, '')) / 10 * (p.startsWith('L') ? -1 : 1)));
}
export function seconds(s: string | undefined, fallback: number): number {
  if (!s || s === 'inf') return fallback;
  return Math.max(0.001, Math.min(60, numberIn(s, fallback) / (s.includes('ms') ? 1000 : 1)));
}
export function ampEnvelope(layer: NS4Layer): AmpEnvelope {
  const decay = seconds(layer.ampEnv?.decay, 0);
  return { attack: seconds(layer.ampEnv?.attack, 0.005), decay, sustain: decay ? 0 : 1, release: seconds(layer.ampEnv?.release, 0.15) };
}

/** Keep note routing separate from sound creation; note-offs use the note-on's route. */
export function layerNote(layer: NS4Layer, zones: ReturnType<typeof programZones>, midi: number): number | null {
  if (zones.hasSplit) {
    const allowed = zones.zones.some((z, i) => {
      if (!z.layers.some(l => l.kind === layer.kind && l.id === layer.id)) return false;
      let low = 0, high = 128;
      for (let j = i - 1; j >= 0; j--) {
        const b = zones.boundaries[j]; const n = b ? noteToMidi(b) : null;
        if (n !== null) { low = n; break; }
      }
      for (let j = i; j < 3; j++) {
        const b = zones.boundaries[j]; const n = b ? noteToMidi(b) : null;
        if (n !== null) { high = n; break; }
      }
      return midi >= low && midi < high;
    });
    if (!allowed) return null;
  }
  const transpose = numberIn(zones.transpose ?? undefined);
  const note = midi + transpose + (layer.octaveShift ?? 0) * 12;
  return note >= 0 && note <= 127 ? note : null;
}
