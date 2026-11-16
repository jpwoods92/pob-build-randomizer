#!/usr/bin/env node
// Downloads the raw game data used to generate src/data/*.json.
//  - Path of Building Community repo (sparse: gems, skills, bases, mods, uniques)
//  - GGG's official passive skill tree export
// Run `npm run build-data` afterwards to regenerate the compact JSON files.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });

function git(args, cwd = cache) {
  console.log(`$ git ${args.join(' ')}`);
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

const pob = join(cache, 'pob');
if (!existsSync(pob)) {
  git([
    'clone', '--depth', '1', '--filter=blob:none', '--sparse',
    'https://github.com/PathOfBuildingCommunity/PathOfBuilding.git', 'pob',
  ]);
  git(['sparse-checkout', 'set', '--no-cone', '/src/Data/*', '/src/GameVersions.lua'], pob);
} else {
  git(['pull', '--ff-only'], pob);
}

const tree = join(cache, 'tree');
if (!existsSync(tree)) {
  git(['clone', '--depth', '1', 'https://github.com/grindinggear/skilltree-export.git', 'tree']);
} else {
  git(['pull', '--ff-only'], tree);
}

console.log('\nData fetched into .cache/. Now run: npm run build-data');
