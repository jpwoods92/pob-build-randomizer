// Shared helpers for PoB game version parsing and local data snapshots.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Parses Path of Building's `src/GameVersions.lua` to determine the latest
 * mainline PoE 1 tree version (e.g. `3_30`), display label (`3.30`), and
 * passive-tree URL version segment (`3.30.0`).
 */
export function parseGameVersionsLua(src) {
  const latestMatch = src.match(/latestTreeVersion\s*=\s*"(\d+_\d+)"/);
  const entries = [
    ...src.matchAll(
      /\["(\d+_\d+)"\]\s*=\s*\{[^}]*display\s*=\s*"([^"]+)"[^}]*url\s*=\s*"https:\/\/www\.pathofexile\.com\/passive-skill-tree\/([^"/]+)\/"/gs,
    ),
  ];
  const fallbackEntries = entries.length > 0
    ? entries
    : [
        ...src.matchAll(
          /\["(\d+_\d+)"\]\s*=\s*\{[^}]*url\s*=\s*"https:\/\/www\.pathofexile\.com\/passive-skill-tree\/([^"/]+)\/"/gs,
        ),
      ].map((m) => [m[0], m[1], m[1].replace(/_/g, '.'), m[2]]);

  const version = latestMatch?.[1] ?? fallbackEntries.at(-1)?.[1] ?? '3_30';
  const matched = fallbackEntries.find((e) => e[1] === version);
  const display = matched?.[2] ?? version.replace(/_/g, '.');
  const urlVersion = matched?.[3] ?? `${version.replace(/_/g, '.')}.0`;
  return { version, display, urlVersion };
}

export function readLocalDataSnapshot(root) {
  const dataDir = join(root, 'src/data');
  const readJson = (name) => {
    const p = join(dataDir, name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  };

  const tree = readJson('tree.json');
  const gems = readJson('gems.json');
  const bases = readJson('bases.json');
  const mods = readJson('mods.json');
  const uniques = readJson('uniques.json');
  const minions = readJson('minions.json');
  const pantheons = readJson('pantheons.json');
  const version = tree?.version ?? 'unknown';

  return {
    version,
    display: version === 'unknown' ? 'unknown' : version.replace(/_/g, '.'),
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

export async function getLocalPobCommit(root) {
  const pobDir = join(root, '.cache/pob');
  if (!existsSync(pobDir)) return null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: pobDir, timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
