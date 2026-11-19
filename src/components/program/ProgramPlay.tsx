import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { KeyboardZoneMap } from '@/components/sample/KeyboardZoneMap';
import { MidiConnect } from '@/components/sample/MidiConnect';
import { getSharedCtx } from '@/components/sample/audioPlayer';
import { useOptionalMidi } from '@/lib/midi/MidiContext';
import { useFolderOptional } from '@/lib/folder/FolderContext';
import { extractBackupEntry } from '@/lib/clavia/backup/extract-entry';
import type { NS4Program } from '@/lib/ns4/types';
import { planProgram } from '@/lib/engine/program/plan';
import { createProgramPlayer, type ProgramPlayer } from '@/lib/engine/program/player';

const NO_ZONES: never[] = [];
const noop = () => {};

/** Explicitly armed: opening a preset never steals MIDI or decodes large pianos. */
export function ProgramPlay({ program, scene }: { program: NS4Program; scene: 'I' | 'II' }) {
  const folder = useFolderOptional();
  const result = folder?.result;
  const plan = useMemo(() => result ? planProgram(program, scene, result) : [], [program, scene, result]);
  const [player, setPlayer] = useState<ProgramPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [velocity, setVelocity] = useState(90);
  const [sounding, setSounding] = useState<ReadonlySet<number>>(new Set());
  const gen = useRef(0);
  const current = useRef<ProgramPlayer | null>(null);
  const midi = useOptionalMidi();
  const setSink = midi?.setSink, clearSink = midi?.clearSink;

  useEffect(() => {
    gen.current++; current.current?.dispose(); current.current = null;
    setPlayer(null); setLoading(false); setSounding(new Set());
    // This is an async-load generation counter, deliberately read at cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { gen.current++; current.current?.dispose(); current.current = null; };
  }, [program, scene, plan]);

  const sink = useMemo(() => player && {
    noteOn: (n: number, v: number) => {
      getSharedCtx(); player.noteOn(n, v);
      setSounding(s => new Set(s).add(n));
    },
    noteOff: (n: number) => { player.noteOff(n); setSounding(s => { const next = new Set(s); next.delete(n); return next; }); },
  }, [player]);
  useEffect(() => {
    if (!sink || !setSink || !clearSink) return;
    setSink(sink); return () => clearSink(sink);
  }, [sink, setSink, clearSink]);

  function stop() {
    gen.current++; current.current?.dispose(); current.current = null;
    setPlayer(null); setLoading(false); setSounding(new Set());
  }
  async function start() {
    const epoch = ++gen.current;
    setLoading(true); setError('');
    try {
      const ctx = getSharedCtx();
      const v = await createProgramPlayer(ctx, program, scene, plan, async source => {
        if (source.bytes) return source.bytes;
        if (!source.ref || !folder) throw new Error('Reconnect the library folder');
        return extractBackupEntry(folder, source.ref);
      }, () => epoch !== gen.current, message => { if (epoch === gen.current) setError(message); });
      if (epoch !== gen.current) { v.dispose(); return; }
      current.current = v; setPlayer(v);
    } catch (e) { if (epoch === gen.current) setError(e instanceof Error ? e.message : 'Could not start playback'); }
    finally { if (epoch === gen.current) setLoading(false); }
  }

  const problems = player?.problems ?? plan.flatMap(p => p.problem ? [`${p.layer.kind} ${p.layer.id}: ${p.problem}`] : []);
  return (
    <div className="ps-card" style={{ marginTop: 12, marginBottom: 12 }}>
      <h4>PLAY THIS PROGRAM · EXPERIMENTAL PREVIEW</h4>
      <p className="ps-sub">
        Plays local piano/sample recordings, an independent organ model and basic analog synth sketches together.
        Scene, splits, transpose, octave shifts, layer levels and pan are applied.
        Nord effects, morphs, arpeggiators, pitch bend, split crossfades and advanced voicing are not reproduced.
        Analog/filter/envelope behavior is approximate; WAVE, FM and other unsupported layers stay silent and are listed below.
      </p>
      {!result && <p className="ps-sub">Choose the folder containing your bundles to load their piano and sample recordings.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => player || loading ? stop() : void start()} disabled={!result}>
          {loading ? 'Cancel loading' : player ? 'Stop program' : 'Play this program'}
        </Button>
        {loading && <span role="status">Loading program instruments…</span>}
        {player && <span role="status">Ready · {player.layers.length} layers: {player.layers.join(', ')}</span>}
      </div>
      {problems.length > 0 && <ul className="ps-sub">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      {error && <p role="alert" className="on-error">{error}</p>}
      {sink && player && player.layers.length > 0 && <>
        <label className="ps-sub">Keyboard velocity {velocity}
          <input aria-label="Program keyboard velocity" type="range" min={1} max={127} value={velocity} onChange={e => setVelocity(Number(e.target.value))} />
        </label>
        <KeyboardZoneMap zones={NO_ZONES} selected={-1} onSelect={noop}
          onNoteOn={n => sink.noteOn(n, velocity)} onNoteOff={sink.noteOff} soundingMidis={sounding} />
        {midi && <MidiConnect what="this program" />}
      </>}
    </div>
  );
}
