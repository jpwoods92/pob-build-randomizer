import type { GameData } from './types.ts';
import { Rng } from './rng.ts';
import { pickArchetype, type BuildArchetype, type BuildOptions, type BuildTargets } from './archetype.ts';
import { generatePassiveTree, patchTreeAttributes, type GeneratedTree } from './tree.ts';
import { generateSkills, type GeneratedSkills } from './skills.ts';
import { generateGear, type GeneratedGear } from './items.ts';
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

export interface TargetEvaluation {
  active: boolean;
  metAll: boolean;
  totalDeficit: number;
  hp: { target?: number; actual: number; met: boolean };
  physMaxHit: { target?: number; actual: number; met: boolean };
  eleMaxHit: { target?: number; actual: number; met: boolean };
  dps: { target?: number; actual: number; met: boolean };
}

export function hasActiveTargets(t?: BuildTargets): boolean {
  if (!t) return false;
  return Boolean(
    (t.minHp && t.minHp > 0) ||
    (t.minPhysMaxHit && t.minPhysMaxHit > 0) ||
    (t.minEleMaxHit && t.minEleMaxHit > 0) ||
    (t.minDps && t.minDps > 0),
  );
}

export function evaluateBuildTargets(
  build: Pick<GeneratedBuild, 'archetype' | 'defenses' | 'offense'>,
): TargetEvaluation {
  const t = build.archetype.options.targets;
  const active = hasActiveTargets(t);
  const hpActual = build.archetype.defenseStyle === 'es'
    ? build.defenses.maxEs
    : build.archetype.defenseStyle === 'hybrid'
      ? build.defenses.maxLife + build.defenses.maxEs
      : build.defenses.maxLife;
  const physActual = build.defenses.physMaxHit;
  const eleActual = build.defenses.eleMaxHit;
  const dpsActual = build.offense.totalDps;

  const hpMet = !(t?.minHp && t.minHp > 0) || hpActual >= t.minHp;
  const physMet = !(t?.minPhysMaxHit && t.minPhysMaxHit > 0) || physActual >= t.minPhysMaxHit;
  const eleMet = !(t?.minEleMaxHit && t.minEleMaxHit > 0) || eleActual >= t.minEleMaxHit;
  const dpsMet = !(t?.minDps && t.minDps > 0) || (build.offense.dpsMode !== 'Support' && dpsActual >= t.minDps);

  let totalDeficit = 0;
  if (t?.minHp && t.minHp > 0 && hpActual < t.minHp) totalDeficit += (t.minHp - hpActual) / t.minHp;
  if (t?.minPhysMaxHit && t.minPhysMaxHit > 0 && physActual < t.minPhysMaxHit) {
    totalDeficit += (t.minPhysMaxHit - physActual) / t.minPhysMaxHit;
  }
  if (t?.minEleMaxHit && t.minEleMaxHit > 0 && eleActual < t.minEleMaxHit) {
    totalDeficit += (t.minEleMaxHit - eleActual) / t.minEleMaxHit;
  }
  if (t?.minDps && t.minDps > 0 && !dpsMet) {
    totalDeficit += build.offense.dpsMode === 'Support' ? 1 : (t.minDps - dpsActual) / t.minDps;
  }

  return {
    active,
    metAll: hpMet && physMet && eleMet && dpsMet,
    totalDeficit,
    hp: { target: t?.minHp, actual: hpActual, met: hpMet },
    physMaxHit: { target: t?.minPhysMaxHit, actual: physActual, met: physMet },
    eleMaxHit: { target: t?.minEleMaxHit, actual: eleActual, met: eleMet },
    dps: { target: t?.minDps, actual: dpsActual, met: dpsMet },
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
  const targetKey = hasActiveTargets(t)
    ? `|${t?.minHp ?? ''}|${t?.minPhysMaxHit ?? ''}|${t?.minEleMaxHit ?? ''}|${t?.minDps ?? ''}`
    : '';
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
