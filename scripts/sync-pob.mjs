#!/usr/bin/env node
// End-to-end Path of Building / GGG tree sync:
//   1. Pulls upstream PoB + skilltree-export changes (skipped when --offline is passed)
//   2. Rebuilds src/data/*.json with dynamic version detection from GameVersions.lua
//   3. Runs unit tests and production build to verify compatibility
//   4. Prints a before/after summary of game version and entity counts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src/data');
const offline = process.argv.includes('--offline');

const nodeBinDir = dirname(process.execPath);
const env = {
  ...process.env,
  PATH: `${nodeBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
};

function readJson(name) {
  const path = join(dataDir, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function snapshotStats() {
  const tree = readJson('tree.json');
  const gems = readJson('gems.json');
  const bases = readJson('bases.json');
  const mods = readJson('mods.json');
  const uniques = readJson('uniques.json');
  const minions = readJson('minions.json');
  const pantheons = readJson('pantheons.json');

  return {
    version: tree?.version ?? 'unknown',
    urlVersion: tree?.urlVersion ?? 'unknown',
    nodes: tree?.nodes ? Object.keys(tree.nodes).length : 0,
    gems: Array.isArray(gems) ? gems.length : 0,
    bases: bases ? Object.keys(bases).length : 0,
    mods: mods ? (mods.item?.length ?? 0) + (mods.flask?.length ?? 0) + (mods.jewel?.length ?? 0) : 0,
    uniques: Array.isArray(uniques) ? uniques.length : 0,
    minions: minions?.minions ? Object.keys(minions.minions).length : 0,
    pantheons: pantheons ? (pantheons.major?.length ?? 0) + (pantheons.minor?.length ?? 0) : 0,
  };
}

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  execFileSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
}

function formatDelta(before, after) {
  const diff = after - before;
  if (diff === 0) return `${after} (unchanged)`;
  return `${before} -> ${after} (${diff > 0 ? '+' : ''}${diff})`;
}

const before = snapshotStats();

if (offline) {
  console.log('=== Skipping fetch-data (--offline mode, using existing .cache/) ===');
} else {
  run(process.execPath, [join(root, 'scripts/fetch-data.mjs')], '1/4 Fetch upstream PoB & passive tree');
}

run(process.execPath, [join(root, 'scripts/build-data.mjs')], `${offline ? '1/3' : '2/4'} Rebuild src/data/*.json`);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run(npmCmd, ['test'], `${offline ? '2/3' : '3/4'} Run test suite`);
run(npmCmd, ['run', 'build'], `${offline ? '3/3' : '4/4'} Type-check & build`);

const after = snapshotStats();
console.log('\n=== PoB Sync Summary ===');
console.log(`Tree version : ${before.version} (${before.urlVersion}) -> ${after.version} (${after.urlVersion})`);
console.log(`Passive nodes: ${formatDelta(before.nodes, after.nodes)}`);
console.log(`Gems         : ${formatDelta(before.gems, after.gems)}`);
console.log(`Item bases   : ${formatDelta(before.bases, after.bases)}`);
console.log(`Mod entries  : ${formatDelta(before.mods, after.mods)}`);
console.log(`Uniques      : ${formatDelta(before.uniques, after.uniques)}`);
console.log(`Minions      : ${formatDelta(before.minions, after.minions)}`);
console.log(`Pantheons    : ${formatDelta(before.pantheons, after.pantheons)}`);
