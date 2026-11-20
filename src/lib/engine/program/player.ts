import type { NS4Program, NS4Layer } from '@/lib/ns4/types';
import { programZones } from '@/lib/ns4/view';
import { createPianoEngine } from '@/components/piano/pianoEngine';
import { readNspDirectory } from '@/lib/ns4/nsp-audio';
import { readNspZones } from '@/lib/ns4/nsp';
import { loadSample } from '@/components/sample/loadSample';
import { createOrganVoice } from '@/lib/engine/organ/organ-voice';
import { organParamsFromLayer } from '@/lib/engine/organ/params';
import { createAnalogVoice, type ProgramVoice } from './synth';
import { ampEnvelope, layerGain, layerPan, layerNote, type PlannedLayer, type SoundSource } from './plan';

export interface ProgramPlayer extends ProgramVoice { layers: string[]; problems: string[] }
export const layerLabel = (l: NS4Layer) => `${l.kind ?? 'synth'} ${l.id}`;

/** One owner for all layers. Cancelling an asynchronous load always disposes it. */
export async function createProgramPlayer(
  ctx: AudioContext, program: NS4Program, scene: 'I' | 'II', plan: PlannedLayer[],
  read: (source: SoundSource) => Promise<Uint8Array>,
  cancelled: () => boolean,
  onError: (message: string) => void,
): Promise<ProgramPlayer> {
  const zones = programZones(program, scene);
  const output = ctx.createGain(); output.gain.value = 0.22;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12;
  limiter.attack.value = 0.003; limiter.release.value = 0.15;
  output.connect(limiter).connect(ctx.destination);
  const parts: { layer: NS4Layer; voice: ProgramVoice }[] = [];
  const nodes: AudioNode[] = [output, limiter];
  const problems: string[] = [];
  const loaded = new Map<string, Uint8Array>();
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const p of parts) p.voice.dispose();
    // Mute synchronously, including release tails, then disconnect the graph.
    output.gain.setValueAtTime(0, ctx.currentTime);
    for (const n of nodes) n.disconnect();
  }
  try {
    for (const p of plan) {
      if (cancelled()) { dispose(); break; }
      const label = layerLabel(p.layer);
      if (p.problem) { problems.push(`${label}: ${p.problem}`); continue; }
      const gain = ctx.createGain(); gain.gain.value = layerGain(p.layer);
      const pan = ctx.createStereoPanner(); pan.pan.value = layerPan(p.layer);
      gain.connect(pan).connect(output); nodes.push(gain, pan);
      try {
        let voice: ProgramVoice;
        if (p.layer.kind === 'organ') {
          const v = await createOrganVoice(ctx, { params: organParamsFromLayer({ ...p.layer, volume: { value: '0 dB' }, octaveShift: 0 }, program.organFx), destination: gain });
          voice = v;
        } else if (p.source) {
          let bytes = loaded.get(p.source.key);
          if (!bytes) { bytes = await read(p.source); loaded.set(p.source.key, bytes); }
          if (cancelled()) { dispose(); break; }
          if (p.layer.kind === 'piano') {
            const dir = readNspDirectory(bytes);
            const v = dir && createPianoEngine(bytes, dir, readNspZones(bytes), { destination: gain, onError });
            if (!v) throw new Error('Piano key map or audio cannot be decoded');
            voice = { noteOn: v.noteOn, noteOff: v.noteOff, dispose: v.stopAll };
          } else {
            const sample = loadSample(bytes, p.source.name, { destination: gain, env: () => ampEnvelope(p.layer), unisonLevel: () => Number(p.layer.unison) || 0 });
            const v = sample.sampler;
            if (!v || !sample.decoded.length || !sample.playableZones.length) throw new Error('Sample audio cannot be decoded');
            voice = { noteOn: v.noteOn, noteOff: v.noteOff, dispose: v.stopAll };
          }
        } else voice = createAnalogVoice(ctx, p.layer, gain);
        if (cancelled()) { voice.dispose(); dispose(); break; }
        parts.push({ layer: p.layer, voice });
      } catch (e) {
        problems.push(`${label}: ${e instanceof Error ? e.message : 'Could not load this layer'}`);
      }
    }
    if (cancelled()) dispose();
  } catch (e) { dispose(); throw e; }
  // Retain exact routed notes, even if the input note was outside the split.
  const held = new Map<number, { voice: ProgramVoice; note: number }[]>();
  const player: ProgramPlayer = {
    layers: parts.map(p => layerLabel(p.layer)), problems,
    noteOn(midi, velocity) {
      if (disposed) return;
      player.noteOff(midi);
      if (velocity <= 0) return;
      const route: { voice: ProgramVoice; note: number }[] = [];
      for (const p of parts) {
        const note = layerNote(p.layer, zones, midi);
        if (note === null) continue;
        try { p.voice.noteOn(note, velocity); route.push({ voice: p.voice, note }); }
        catch (e) { onError(`${layerLabel(p.layer)}: ${e instanceof Error ? e.message : 'Could not play note'}`); }
      }
      held.set(midi, route);
    },
    noteOff(midi) { for (const p of held.get(midi) ?? []) p.voice.noteOff(p.note); held.delete(midi); },
    dispose,
  };
  return player;
}
