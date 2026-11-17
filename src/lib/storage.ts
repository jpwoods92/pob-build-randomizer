import type { BuildOptions } from './archetype.ts';
import type { GeneratedBuild } from './generator.ts';

export const SAVED_BUILDS_STORAGE_KEY = 'pob-randomizer-saved-builds';
const MAX_SAVED_BUILDS = 50;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedBuildEntry {
  id: string;
  name: string;
  savedAt: string;
  treeVersion: string;
  options: BuildOptions;
  summary: {
    title: string;
    className: string;
    ascendancyName: string;
    mainSkill: string;
    damageStyle: string;
    defenseStyle: string;
    dpsMode: string;
    totalDps: number;
    maxLife: number;
    maxEs: number;
    effEleRes: number;
    effChaosRes: number;
  };
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function buildOptionsSignature(opts: BuildOptions): string {
  const base = [
    opts.seed,
    opts.leagueMode,
    opts.economy,
    opts.classId,
    opts.ascendancyIndex,
    opts.level,
    opts.damageStyle,
    opts.defenseStyle,
  ].join('|');
  const t = opts.targets;
  if (!t || (!t.minHp && !t.minPhysMaxHit && !t.minEleMaxHit && !t.minDps)) return base;
  return `${base}|${t.minHp ?? ''}|${t.minPhysMaxHit ?? ''}|${t.minEleMaxHit ?? ''}|${t.minDps ?? ''}`;
}

export function loadSavedBuilds(storage: StorageLike | null = defaultStorage()): SavedBuildEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_BUILDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is SavedBuildEntry =>
        Boolean(x && typeof x.id === 'string' && typeof x.name === 'string' && x.options && typeof x.options.seed === 'string'),
    );
  } catch {
    return [];
  }
}

function persistSavedBuilds(entries: SavedBuildEntry[], storage: StorageLike | null = defaultStorage()): SavedBuildEntry[] {
  const capped = entries.slice(0, MAX_SAVED_BUILDS);
  if (storage) {
    try {
      storage.setItem(SAVED_BUILDS_STORAGE_KEY, JSON.stringify(capped));
    } catch {
      // ignore quota / privacy-mode storage errors
    }
  }
  return capped;
}

export function saveBuildToStorage(
  build: GeneratedBuild,
  treeVersion: string,
  customName?: string,
  storage: StorageLike | null = defaultStorage(),
): { entries: SavedBuildEntry[]; saved: SavedBuildEntry; updated: boolean } {
  const existing = loadSavedBuilds(storage);
  const id = buildOptionsSignature(build.archetype.options);
  const prevIdx = existing.findIndex((e) => e.id === id);
  const name = customName?.trim() || (prevIdx >= 0 ? existing[prevIdx].name : build.archetype.title);

  const entry: SavedBuildEntry = {
    id,
    name,
    savedAt: new Date().toISOString(),
    treeVersion,
    options: {
      ...build.archetype.options,
      targets: build.archetype.options.targets ? { ...build.archetype.options.targets } : undefined,
    },
    summary: {
      title: build.archetype.title,
      className: build.archetype.classData.name,
      ascendancyName: build.archetype.ascendancy.name,
      mainSkill: build.archetype.mainSkill.name,
      damageStyle: build.archetype.damageStyle,
      defenseStyle: build.archetype.defenseStyle,
      dpsMode: build.offense.dpsMode,
      totalDps: build.offense.totalDps,
      maxLife: build.defenses.maxLife,
      maxEs: build.defenses.maxEs,
      effEleRes: build.defenses.effEleRes,
      effChaosRes: build.defenses.effChaosRes,
    },
  };

  const next = [entry, ...existing.filter((e) => e.id !== id)];
  return { entries: persistSavedBuilds(next, storage), saved: entry, updated: prevIdx >= 0 };
}

export function renameSavedBuild(
  id: string,
  nextName: string,
  storage: StorageLike | null = defaultStorage(),
): SavedBuildEntry[] {
  const trimmed = nextName.trim();
  if (!trimmed) return loadSavedBuilds(storage);
  const updated = loadSavedBuilds(storage).map((e) => (e.id === id ? { ...e, name: trimmed } : e));
  return persistSavedBuilds(updated, storage);
}

export function deleteSavedBuild(
  id: string,
  storage: StorageLike | null = defaultStorage(),
): SavedBuildEntry[] {
  const filtered = loadSavedBuilds(storage).filter((e) => e.id !== id);
  return persistSavedBuilds(filtered, storage);
}

export function clearSavedBuilds(storage: StorageLike | null = defaultStorage()): SavedBuildEntry[] {
  return persistSavedBuilds([], storage);
}
