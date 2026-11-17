#!/usr/bin/env node
// End-to-end Path of Building / GGG tree sync:
//   1. Pulls upstream PoB + skilltree-export changes (skipped when --offline is passed)
//   2. Rebuilds src/data/*.json with dynamic version detection from GameVersions.lua
//   3. Runs unit tests and production build to verify compatibility
//   4. Prints a before/after summary of game version and entity counts
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalDataSnapshot } from './pob-version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');

const nodeBinDir = dirname(process.execPath);
const env = {
  ...process.env,
  PATH: `${nodeBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
};

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  execFileSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
}

function formatDelta(before, after) {
  const diff = after - before;
  if (diff === 0) return `${after} (unchanged)`;
  return `${before} -> ${after} (${diff > 0 ? '+' : ''}${diff})`;
}

const before = readLocalDataSnapshot(root);

if (offline) {
  console.log('=== Skipping fetch-data (--offline mode, using existing .cache/) ===');
} else {
  run(process.execPath, [join(root, 'scripts/fetch-data.mjs')], '1/4 Fetch upstream PoB & passive tree');
}

run(process.execPath, [join(root, 'scripts/build-data.mjs')], `${offline ? '1/3' : '2/4'} Rebuild src/data/*.json`);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run(npmCmd, ['test'], `${offline ? '2/3' : '3/4'} Run test suite`);
run(npmCmd, ['run', 'build'], `${offline ? '3/3' : '4/4'} Type-check & build`);

const after = readLocalDataSnapshot(root);
console.log('\n=== PoB Sync Summary ===');
console.log(`Tree version : ${before.version} (${before.urlVersion}) -> ${after.version} (${after.urlVersion})`);
console.log(`Passive nodes: ${formatDelta(before.nodes, after.nodes)}`);
console.log(`Gems         : ${formatDelta(before.gems, after.gems)}`);
console.log(`Item bases   : ${formatDelta(before.bases, after.bases)}`);
console.log(`Mod entries  : ${formatDelta(before.mods, after.mods)}`);
console.log(`Uniques      : ${formatDelta(before.uniques, after.uniques)}`);
console.log(`Minions      : ${formatDelta(before.minions, after.minions)}`);
console.log(`Pantheons    : ${formatDelta(before.pantheons, after.pantheons)}`);
