export interface ParsedTreeVersion {
  version: string;
  display: string;
  urlVersion: string;
}

export interface LocalDataSnapshot {
  version: string;
  display: string;
  urlVersion: string;
  nodes: number;
  gems: number;
  bases: number;
  mods: number;
  uniques: number;
  minions: number;
  pantheons: number;
}

export function parseGameVersionsLua(src: string): ParsedTreeVersion;
export function readLocalDataSnapshot(root: string): LocalDataSnapshot;
export function getLocalPobCommit(root: string): Promise<string | null>;
