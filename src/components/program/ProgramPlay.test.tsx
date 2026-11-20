// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NS4Program } from '@/lib/ns4/types';
import type { ProgramPlayer } from '@/lib/engine/program/player';
const mocks = vi.hoisted(() => ({
  create: vi.fn(), setSink: vi.fn(), clearSink: vi.fn(),
  folder: { result: {}, openBundle: vi.fn() },
}));
vi.mock('@/lib/folder/FolderContext', () => ({ useFolderOptional: () => mocks.folder }));
vi.mock('@/lib/midi/MidiContext', () => ({ useOptionalMidi: () => ({ setSink: mocks.setSink, clearSink: mocks.clearSink }) }));
vi.mock('@/lib/engine/program/plan', () => ({ planProgram: () => [] }));
vi.mock('@/lib/engine/program/player', () => ({ createProgramPlayer: mocks.create }));
vi.mock('@/components/sample/audioPlayer', () => ({ getSharedCtx: vi.fn(() => ({})) }));
vi.mock('@/components/sample/MidiConnect', () => ({ MidiConnect: () => null }));
vi.mock('@/components/sample/KeyboardZoneMap', () => ({ KeyboardZoneMap: () => null }));
import { ProgramPlay } from './ProgramPlay';
import { setProgramArmed } from '@/lib/engine/program/armed';
const program = (name: string) => ({ name } as NS4Program);
const player = (): ProgramPlayer => ({ layers: ['piano A'], problems: [], dispose: vi.fn(), noteOn: vi.fn(), noteOff: vi.fn() });
beforeEach(() => { setProgramArmed(true); vi.clearAllMocks(); mocks.create.mockImplementation(async () => player()); });
afterEach(cleanup);

it('automatically arms the selected program and keeps the intent across keyed remounts', async () => {
  const first = player(); const second = player();
  mocks.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const view = render(<ProgramPlay key="a" program={program('Clean Church')} scene="I" />);
  await screen.findByText(/Ready/);
  expect(mocks.create).toHaveBeenCalledOnce();
  view.rerender(<ProgramPlay key="b" program={program('Dirt Church')} scene="I" />);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(first.dispose).toHaveBeenCalledOnce();
  await screen.findByText(/Ready/);
  expect(screen.getByRole('button', { name: 'Disarm programs' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.setSink).toHaveBeenCalledTimes(2);
  view.unmount(); expect(second.dispose).toHaveBeenCalledOnce();
});
it('keeps programs disarmed across selections until explicitly rearmed', async () => {
  const first = player(); mocks.create.mockResolvedValueOnce(first);
  const view = render(<ProgramPlay key="a" program={program('A')} scene="I" />);
  await screen.findByText(/Ready/);
  fireEvent.click(screen.getByRole('button', { name: 'Disarm programs' }));
  expect(first.dispose).toHaveBeenCalledOnce();
  view.rerender(<ProgramPlay key="b" program={program('B')} scene="I" />);
  expect(mocks.create).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Arm programs' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
});
it('cancels a previous load on scene change and disposes a late result', async () => {
  let finish!: (v: ProgramPlayer) => void;
  mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const p = program('A'); const old = player();
  const view = render(<ProgramPlay program={p} scene="I" />);
  expect(screen.getByText(/Loading program instruments/)).toBeTruthy();
  view.rerender(<ProgramPlay program={p} scene="II" />);
  await screen.findByText(/Ready/);
  await act(async () => { finish(old); });
  expect(old.dispose).toHaveBeenCalledOnce();
  const cancelled = mocks.create.mock.calls[0][5] as () => boolean;
  expect(cancelled()).toBe(true);
});
