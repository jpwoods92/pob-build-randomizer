// Shapes of the generated JSON in src/data (see scripts/build-data.mjs).

export type NodeType = 'normal' | 'notable' | 'keystone' | 'mastery' | 'jewel' | 'start' | 'ascStart';

export interface TreeNode {
  n: string;
  t: NodeType;
  x: number;
  y: number;
  adj: number[];
  s?: string[];
  a?: string;
  cls?: number;
  gp?: number;
  mc?: 1;
  mco?: 1;
  me?: { e: number; s: string[] }[];
  gs?: number;
  gd?: number;
  gi?: number;
}

export interface AscendancyData {
  id: number;
  internal: string;
  name: string;
  start: number | null;
}

export interface ClassData {
  id: number;
  name: string;
  str: number;
  dex: number;
  int: number;
  start: number;
  ascendancies: AscendancyData[];
}

export interface TreeData {
  version: string;
  urlVersion: string;
  points: { totalPoints: number; ascendancyPoints: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  classes: ClassData[];
  nodes: Record<string, TreeNode>;
}

export interface GemData {
  key: string;
  gameId: string;
  variantId: string;
  skillId: string;
  name: string;
  tags: string[];
  str: number;
  dex: number;
  int: number;
  maxLevel: number;
  support: boolean;
  color: number;
  types: string[];
  minionTypes?: string[];
  require?: string[];
  exclude?: string[];
  add?: string[];
  weaponTypes?: string[];
  isTrigger?: boolean;
  ignoreMinionTypes?: boolean;
  levelReq?: number;
  reservePct?: number;
  reserveFlat?: number;
  description?: string;
}

export interface BaseData {
  type: string;
  subType?: string;
  tags: string[];
  req: { level?: number; str?: number; dex?: number; int?: number };
  implicit?: string;
  sockets?: number;
  weapon?: { PhysicalMin?: number; PhysicalMax?: number; CritChanceBase: number; AttackRateBase: number; Range: number };
  armour?: Record<string, number>;
  flask?: Record<string, unknown>;
}

export interface ModData {
  id: string;
  t: 'P' | 'S';
  affix: string;
  lines: string[];
  lvl: number;
  group: string;
  wk: string[];
  wv: number[];
  tags?: string[];
}

export interface UniqueData {
  name: string;
  base: string;
  type: string;
  implicits: string[];
  explicits: string[];
  variants?: string[];
  versions?: string[];
  extra?: string[];
  levelReq?: number;
  source?: string;
  league?: string;
}

export interface PantheonGod {
  id: string;
  name: string;
  mods: string[];
}

export interface PantheonData {
  major: PantheonGod[];
  minor: PantheonGod[];
}

export interface MinionEntry {
  id: string;
  name: string;
  damage: number;
  attackTime: number;
  limitKey?: string;
  skillMult: number;
  isSpell?: boolean;
  castTime?: number;
  moreDamage: number;
  moreSpeed: number;
  incDamage: number;
  incSpeed: number;
  addedFlat?: number;
}

export interface GemMinionMeta {
  minionList: string[];
  limit: number;
  limitType: string;
  actorLevel20: number;
  gemMoreDamage: number;
  gemMoreSpeed: number;
  addedPhysAvg: number;
  virulenceScale?: boolean;
}

export interface MinionsData {
  allyDamageTable: number[];
  minions: Record<string, MinionEntry>;
  gemMinions: Record<string, GemMinionMeta>;
}

export interface ClusterSocketMeta {
  id: number;
  size: number;
  index: number;
  proxy: number;
  parent?: number;
  px: number;
  py: number;
}

export interface ClusterNodeTemplate {
  n: string;
  s: string[];
  ks?: 1;
}

export interface ClusterSkillDef {
  name: string;
  tag: string;
  stats: string[];
  enchant: string[];
}

export interface ClusterJewelDef {
  size: 'Small' | 'Medium' | 'Large';
  sizeIndex: 0 | 1 | 2;
  minNodes: number;
  maxNodes: number;
  smallIndicies: number[];
  notableIndicies: number[];
  socketIndicies: number[];
  totalIndicies: number;
  skills: Record<string, ClusterSkillDef>;
}

export interface ClusterData {
  constants: { orbitRadii: number[]; skillsPerOrbit: number[] };
  sockets: Record<string, ClusterSocketMeta>;
  clusterNodes: Record<string, ClusterNodeTemplate>;
  jewels: Record<string, ClusterJewelDef>;
  notableSortOrder: Record<string, number>;
  orbitOffsets: Record<string, Record<string, number>>;
  mods: ModData[];
}

export interface GameData {
  tree: TreeData;
  gems: GemData[];
  bases: Record<string, BaseData>;
  mods: { item: ModData[]; flask: ModData[]; jewel: ModData[] };
  uniques: UniqueData[];
  pantheons: PantheonData;
  minions: MinionsData;
  clusters: ClusterData;
}
