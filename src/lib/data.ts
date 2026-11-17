import type { GameData } from './types.ts';

let cache: Promise<GameData> | null = null;

/** Lazily loads the (large) generated data files so the UI shell can render first. */
export function loadGameData(): Promise<GameData> {
  if (!cache) {
    cache = Promise.all([
      import('../data/tree.json'),
      import('../data/gems.json'),
      import('../data/bases.json'),
      import('../data/mods.json'),
      import('../data/uniques.json'),
      import('../data/pantheons.json'),
      import('../data/minions.json'),
    ]).then(([tree, gems, bases, mods, uniques, pantheons, minions]) => ({
      tree: tree.default,
      gems: gems.default,
      bases: bases.default,
      mods: mods.default,
      uniques: uniques.default,
      pantheons: pantheons.default,
      minions: minions.default,
    }) as unknown as GameData);
  }
  return cache;
}
