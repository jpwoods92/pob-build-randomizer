import type { GameData } from './types.ts';
import { Rng } from './rng.ts';
import {
  pickArchetype,
  type BuildArchetype,
  type BuildOptions,
  type BuildTargets,
  type TargetStatKey,
} from './archetype.ts';
import {
  encodeTreeUrl,
  generatePassiveTree,
  patchTreeAttributes,
  scoreStatsText,
  type GeneratedTree,
} from './tree.ts';
import { generateSkills, type GeneratedSkills } from './skills.ts';
import { generateGear, rerollGearItem, type GeneratedGear, type GeneratedItem } from './items.ts';
import { rerollClusterJewelSocket } from './cluster.ts';
import { computeProjectedDefenses, computeProjectedOffense, type ProjectedDefenses, type ProjectedOffense } from './stats.ts';
import { buildPobXml, encodePobCode } from './pob-export.ts';

export interface GeneratedBuild {
  archetype: BuildArchetype;
  tree: GeneratedTree;
  skills: GeneratedSkills;
  gear: GeneratedGear;
  defenses: ProjectedDefenses;
  offense: ProjectedOffense;
  xml: string;
  pobCode: string;
}

export interface TargetStatDef {
  key: TargetStatKey;
  label: string;
  shortLabel: string;
  unit: '' | '%';
  min: number;
  max?: number;
  step: number;
  defaultValue: number;
  placeholder: string;
  getActual: (build: Pick<GeneratedBuild, 'archetype' | 'defenses' | 'offense'>) => number;
  isMet?: (build: Pick<GeneratedBuild, 'archetype' | 'defenses' | 'offense'>, target: number) => boolean;
}

export const TARGET_STAT_DEFS: readonly TargetStatDef[] = [
  {
    key: 'minHp',
    label: 'HP / ES Pool',
    shortLabel: 'Pool',
    unit: '',
    min: 100,
    step: 500,
    defaultValue: 5000,
    placeholder: '5000',
    getActual: (b) =>
      b.archetype.defenseStyle === 'es'
        ? b.defenses.maxEs
        : b.archetype.defenseStyle === 'hybrid'
          ? b.defenses.maxLife + b.defenses.maxEs
          : b.defenses.maxLife,
  },
  {
    key: 'minDps',
    label: 'Projected DPS',
    shortLabel: 'DPS',
    unit: '',
    min: 1000,
    step: 50000,
    defaultValue: 500000,
    placeholder: '500000',
    getActual: (b) => (b.offense.dpsMode === 'Support' ? 0 : b.offense.totalDps),
    isMet: (b, tgt) => b.offense.dpsMode !== 'Support' && b.offense.totalDps >= tgt,
  },
  {
    key: 'minPhysMaxHit',
    label: 'Phys Max Hit',
    shortLabel: 'Phys Hit',
    unit: '',
    min: 500,
    step: 2500,
    defaultValue: 15000,
    placeholder: '15000',
    getActual: (b) => b.defenses.physMaxHit,
  },
  {
    key: 'minEleMaxHit',
    label: 'Ele Max Hit',
    shortLabel: 'Ele Hit',
    unit: '',
    min: 1000,
    step: 5000,
    defaultValue: 40000,
    placeholder: '40000',
    getActual: (b) => b.defenses.eleMaxHit,
  },
  {
    key: 'minChaosMaxHit',
    label: 'Chaos Max Hit',
    shortLabel: 'Chaos Hit',
    unit: '',
    min: 500,
    step: 2500,
    defaultValue: 15000,
    placeholder: '15000',
    getActual: (b) => (b.defenses.chaosMaxHit === null ? Infinity : b.defenses.chaosMaxHit),
  },
  {
    key: 'minArmour',
    label: 'Armour',
    shortLabel: 'Armour',
    unit: '',
    min: 100,
    step: 2000,
    defaultValue: 15000,
    placeholder: '15000',
    getActual: (b) => b.defenses.armour,
  },
  {
    key: 'minEvasion',
    label: 'Evasion Rating',
    shortLabel: 'Evasion',
    unit: '',
    min: 100,
    step: 2000,
    defaultValue: 15000,
    placeholder: '15000',
    getActual: (b) => b.defenses.evasion,
  },
  {
    key: 'minEvadePct',
    label: 'Evade Chance %',
    shortLabel: 'Evade %',
    unit: '%',
    min: 5,
    max: 95,
    step: 5,
    defaultValue: 65,
    placeholder: '65',
    getActual: (b) => b.defenses.evadeChancePct,
  },
  {
    key: 'minSuppressPct',
    label: 'Spell Suppression %',
    shortLabel: 'Suppress %',
    unit: '%',
    min: 1,
    max: 100,
    step: 10,
    defaultValue: 100,
    placeholder: '100',
    getActual: (b) => b.defenses.spellSuppressPct,
  },
  {
    key: 'minDodgePct',
    label: 'Spell Dodge %',
    shortLabel: 'Dodge %',
    unit: '%',
    min: 1,
    max: 75,
    step: 5,
    defaultValue: 50,
    placeholder: '50',
    getActual: (b) => Math.max(b.defenses.spellDodgePct, b.defenses.attackDodgePct),
  },
  {
    key: 'minMaxFireRes',
    label: 'Max Ele Res %',
    shortLabel: 'Max Res %',
    unit: '%',
    min: 76,
    max: 90,
    step: 1,
    defaultValue: 78,
    placeholder: '78',
    getActual: (b) => b.defenses.maxEleRes,
  },
  {
    key: 'minCritChancePct',
    label: 'Crit Chance %',
    shortLabel: 'Crit %',
    unit: '%',
    min: 5,
    max: 100,
    step: 5,
    defaultValue: 50,
    placeholder: '50',
    getActual: (b) => b.offense.critChancePct,
  },
  {
    key: 'minAttackBlockPct',
    label: 'Attack Block %',
    shortLabel: 'Atk Block %',
    unit: '%',
    min: 5,
    max: 90,
    step: 5,
    defaultValue: 50,
    placeholder: '50',
    getActual: (b) => b.defenses.attackBlockPct,
  },
  {
    key: 'minSpellBlockPct',
    label: 'Spell Block %',
    shortLabel: 'Spell Block %',
    unit: '%',
    min: 5,
    max: 90,
    step: 5,
    defaultValue: 50,
    placeholder: '50',
    getActual: (b) => b.defenses.spellBlockPct,
  },
];

export interface TargetEvalItem {
  key: TargetStatKey;
  label: string;
  shortLabel: string;
  unit: '' | '%';
  target: number;
  actual: number;
  met: boolean;
}

export interface TargetEvaluation {
  active: boolean;
  metAll: boolean;
  metCount: number;
  totalCount: number;
  totalDeficit: number;
  items: TargetEvalItem[];
}

export function serializeTargetsKey(t?: BuildTargets): string {
  if (!t) return '';
  const parts: string[] = [];
  for (const def of TARGET_STAT_DEFS) {
    const v = t[def.key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      parts.push(`${def.key}=${v}`);
    }
  }
  return parts.length > 0 ? `|${parts.join('|')}` : '';
}

export function hasActiveTargets(t?: BuildTargets): boolean {
  if (!t) return false;
  return TARGET_STAT_DEFS.some((def) => {
    const v = t[def.key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  });
}

export function evaluateBuildTargets(
  build: Pick<GeneratedBuild, 'archetype' | 'defenses' | 'offense'>,
): TargetEvaluation {
  const t = build.archetype.options.targets;
  const items: TargetEvalItem[] = [];
  let totalDeficit = 0;

  for (const def of TARGET_STAT_DEFS) {
    const target = t?.[def.key];
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) continue;
    const actual = def.getActual(build);
    const met = def.isMet ? def.isMet(build, target) : actual >= target;
    if (!met) {
      totalDeficit += def.key === 'minDps' && build.offense.dpsMode === 'Support'
        ? 1
        : (target - actual) / target;
    }
    items.push({
      key: def.key,
      label: def.label,
      shortLabel: def.shortLabel,
      unit: def.unit,
      target,
      actual,
      met,
    });
  }

  const metCount = items.filter((item) => item.met).length;
  return {
    active: items.length > 0,
    metAll: items.every((item) => item.met),
    metCount,
    totalCount: items.length,
    totalDeficit,
    items,
  };
}

function buildCoreCandidate(data: GameData, options: BuildOptions, rng: Rng) {
  const archetype = pickArchetype(data, options, rng.fork('arch'));
  const skills = generateSkills(data, archetype, rng.fork('skills'));
  const tree = generatePassiveTree(data, archetype, rng.fork('tree'), skills.maxReq, skills.manaReservedPct);
  const gear = generateGear(data, archetype, tree, skills, rng.fork('gear'));
  const addedTreeAttrs = patchTreeAttributes(data, archetype, tree, gear.requiredAttributes, gear.attributes);
  gear.attributes.str += addedTreeAttrs.str;
  gear.attributes.dex += addedTreeAttrs.dex;
  gear.attributes.int += addedTreeAttrs.int;
  const defenses = computeProjectedDefenses(data, archetype, tree, skills, gear);
  const offense = computeProjectedOffense(data, archetype, tree, skills, gear);
  return { archetype, tree, skills, gear, defenses, offense };
}

export async function generateBuild(data: GameData, options: BuildOptions): Promise<GeneratedBuild> {
  const t = options.targets;
  const targetKey = serializeTargetsKey(t);
  const baseSeedKey =
    `${options.seed}|${options.leagueMode}|${options.economy}|${options.classId}|${options.ascendancyIndex}|${options.level}|${options.damageStyle}|${options.defenseStyle}${targetKey}`;

  const maxAttempts = hasActiveTargets(t) ? 16 : 1;
  let bestCandidate = buildCoreCandidate(data, options, new Rng(baseSeedKey));
  let bestEval = evaluateBuildTargets(bestCandidate);

  for (let attempt = 1; attempt < maxAttempts && !bestEval.metAll; attempt++) {
    const candidate = buildCoreCandidate(data, options, new Rng(`${baseSeedKey}|try-${attempt}`));
    const ev = evaluateBuildTargets(candidate);
    if (ev.totalDeficit < bestEval.totalDeficit) {
      bestCandidate = candidate;
      bestEval = ev;
    }
  }

  const xml = buildPobXml({ ...bestCandidate, data });
  const pobCode = await encodePobCode(xml);
  return { ...bestCandidate, xml, pobCode };
}

export async function rerollBuildItem(
  data: GameData,
  build: GeneratedBuild,
  itemId: number,
  rerollSeed: string,
): Promise<GeneratedBuild> {
  const rng = new Rng(rerollSeed);
  const oldItem = build.gear.items.find((it) => it.id === itemId);
  if (!oldItem) return build;

  let nextTree = build.tree;
  let clusterReplacement: GeneratedItem | undefined;

  if (oldItem.base.subType === 'Cluster' && oldItem.jewelNodeId !== undefined && build.tree.clusterJewels) {
    const cjRes = rerollClusterJewelSocket(
      data,
      build.archetype,
      rng.fork('cluster'),
      build.tree.clusterNodes ?? {},
      build.tree.clusterJewels,
      build.tree.nodes,
      oldItem.jewelNodeId,
      build.tree.pointsBudget,
      build.tree.pointsUsed,
      (s) => scoreStatsText(s, build.archetype),
    );
    if (cjRes) {
      const nextNotables = cjRes.nodes
        .map((id) => data.tree.nodes[id] ?? cjRes.clusterNodes[id])
        .filter((n) => n && n.t === 'notable' && !n.a)
        .map((n) => n.n);
      nextTree = {
        ...build.tree,
        nodes: cjRes.nodes,
        clusterNodes: cjRes.clusterNodes,
        clusterJewels: cjRes.clusterJewels,
        pointsUsed: cjRes.pointsUsed,
        summary: {
          ...build.tree.summary,
          notables: nextNotables,
        },
        url: encodeTreeUrl(
          data.tree.urlVersion,
          build.tree.classId,
          build.tree.ascendClassId,
          cjRes.nodes,
          build.tree.masteryEffects,
          data.tree,
        ),
      };
      clusterReplacement = {
        ...oldItem,
        name: cjRes.updatedJewel.name,
        itemLevel: cjRes.updatedJewel.itemLevel,
        implicits: cjRes.updatedJewel.implicits,
        explicits: cjRes.updatedJewel.explicits,
        prefixes: cjRes.updatedJewel.prefixes,
        suffixes: cjRes.updatedJewel.suffixes,
        rawText: cjRes.updatedJewel.rawText,
      };
    }
  }

  const nextGear = rerollGearItem(
    data,
    build.archetype,
    nextTree,
    build.skills,
    build.gear,
    itemId,
    rng.fork('gear'),
    clusterReplacement,
  );
  const defenses = computeProjectedDefenses(data, build.archetype, nextTree, build.skills, nextGear);
  const offense = computeProjectedOffense(data, build.archetype, nextTree, build.skills, nextGear);
  const nextCore = {
    archetype: build.archetype,
    tree: nextTree,
    skills: build.skills,
    gear: nextGear,
    defenses,
    offense,
  };
  const xml = buildPobXml({ ...nextCore, data });
  const pobCode = await encodePobCode(xml);
  return { ...nextCore, xml, pobCode };
}
