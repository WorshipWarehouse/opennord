// Opt-in local verification; vendor audio stays outside the repository.
import { it, expect } from 'vitest';
import { openAsBlob } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { indexBackup } from '../clavia/backup/backup-index';
import { extractZipEntry } from '../clavia/backup/zip-directory';
import { planProgram } from '../engine/program/plan';
import { parseNs4Program } from '../ns4/parse';
import { scanFiles } from './scan';

const directory = process.env.NORD_BUNDLE_DIR;
it.skipIf(!directory)('indexes local Stage 4 bundles and parses every contained program', async () => {
  const names = (await readdir(directory!)).filter(n => n.toLowerCase().endsWith('.ns4pbundle'));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const blob = await openAsBlob(join(directory!, name));
    const contents = await indexBackup(blob, name);
    expect(contents.programs.length).toBeGreaterThan(0);
    for (const entry of contents.programs) {
      const bytes = await extractZipEntry(blob, entry);
      const result = scanFiles([{ path: `${name}!${entry.path}`, bytes }]);
      expect(result.errors, entry.path).toEqual([]);
      expect(result.programs).toHaveLength(1);
    }
    console.info(name, { programs: contents.programs.length, pianos: contents.pianos.length, samples: contents.samples.length });
  }
}, 60_000);

it.skipIf(!directory)('resolves every active bundled piano/sample without downloading dependencies', async () => {
  const names = (await readdir(directory!)).filter(n => n.toLowerCase().endsWith('.ns4pbundle'));
  const programs = [];
  const files = scanFiles([]);
  for (const name of names) {
    const blob = await openAsBlob(join(directory!, name));
    const contents = await indexBackup(blob, name);
    files.backupPianos.push(...contents.pianos);
    files.backupSamples.push(...contents.samples);
    for (const e of contents.programs) programs.push(parseNs4Program(await extractZipEntry(blob, e)));
  }
  let checked = 0;
  for (const p of programs) for (const scene of ['I', 'II'] as const) {
    for (const l of planProgram(p, scene, files)) {
      if (l.layer.kind !== 'piano' && l.layer.source !== 'samples') continue;
      expect(l.problem, `${l.layer.pianoModelName ?? l.layer.sample?.name} / ${scene}`).toBeUndefined();
      expect(l.source).toBeDefined(); checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
  console.info(`Resolved ${checked} active piano/sample layer references across both scenes`);
}, 60_000);
