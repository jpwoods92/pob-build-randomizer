import type { GameData } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { GeneratedTree } from './tree.ts';
import type { GeneratedSkills } from './skills.ts';
import type { GeneratedGear } from './items.ts';

export interface ProjectedDefenses {
  lifePct: number;
  esPct: number;
  maxLife: number;
  maxEs: number;
  armour: number;
  evasion: number;
  maxEleRes: number;
  effEleRes: number;
  effChaosRes: number;
  physMaxHit: number;
  eleMaxHit: number;
  chaosMaxHit: number | null; // null = Immune (Chaos Inoculation)
}

function collectTreeLines(data: GameData, tree: GeneratedTree): string[] {
  const lines: string[] = [];
  for (const id of tree.nodes) {
    const n = data.tree.nodes[id];
    if (!n) continue;
    if (n.s) lines.push(...n.s);
    if (n.t === 'mastery' && tree.masteryEffects[id]) {
      const eff = n.me?.find((m) => m.e === tree.masteryEffects[id]);
      if (eff) lines.push(...eff.s);
    }
  }
  return lines;
}

export function computeProjectedDefenses(
  data: GameData,
  arch: BuildArchetype,
  tree: GeneratedTree,
  skills: GeneratedSkills,
  gear: GeneratedGear,
): ProjectedDefenses {
  const treeLines = collectTreeLines(data, tree);
  const keystones = new Set(tree.summary.keystones);
  const hasCI = keystones.has('Chaos Inoculation');
  const hasEB = keystones.has('Eldritch Battery');
  const hasIR = keystones.has('Iron Reflexes');

  // 1. Gather passive tree modifiers
  let flatLife = arch.bandit === 'Oak' ? 40 : 0;
  let incLife = 0;
  let moreLifeMult = 1;
  let flatEs = 0;
  let incEs = 0;
  let incArmour = 0;
  let incEvasion = 0;
  let maxFireBonus = 0;
  let maxColdBonus = 0;
  let maxLightBonus = 0;
  let maxChaosBonus = 0;
  let flatPdr = arch.pantheonMajor === 'Solaris' ? 6 : 0;
  let noStrLife = false;

  const parseGlobalLines = (lines: string[], isTree: boolean) => {
    for (const raw of lines) {
      const l = raw.replace(/\{[^}]+\}/g, '');
      if (/Strength provides no bonus to Maximum Life/i.test(l)) noStrLife = true;

      const mFlatLife = /^\+(\d+) to maximum Life$/i.exec(l);
      if (mFlatLife) flatLife += Number(mFlatLife[1]);

      const mIncLife = /(\d+)% increased maximum Life/i.exec(l);
      if (mIncLife && !/minions/i.test(l)) incLife += Number(mIncLife[1]);

      const mMoreLife = /(\d+)% more Maximum Life if you have at least 6 Life Masteries/i.exec(l);
      if (mMoreLife) {
        const lifeMasteries = tree.summary.masteries.filter((m) => m.name === 'Life Mastery').length;
        if (lifeMasteries >= 6) moreLifeMult *= 1 + Number(mMoreLife[1]) / 100;
      }

      if (isTree || !/^(?:Armour|Evasion|Energy Shield)/i.test(l)) {
        const mFlatEs = /^\+(\d+) to maximum Energy Shield$/i.exec(l);
        if (mFlatEs) flatEs += Number(mFlatEs[1]);
      }

      const mIncEs = /(\d+)% increased (?:maximum |Global )?Energy Shield$/i.exec(l);
      if (mIncEs && (isTree || /Global/i.test(l) || /maximum/i.test(l))) {
        incEs += Number(mIncEs[1]);
      }

      if (isTree || /Global|Armour and Evasion/i.test(l)) {
        const mArm = /(\d+)% increased (?:Global )?Armour\b/i.exec(l);
        if (mArm && !/Armour and Evasion/i.test(l)) incArmour += Number(mArm[1]);
        const mEva = /(\d+)% increased (?:Global )?Evasion Rating/i.exec(l);
        if (mEva && !/Armour and Evasion/i.test(l)) incEvasion += Number(mEva[1]);
        const mAe = /(\d+)% increased Armour and Evasion/i.exec(l);
        if (mAe) {
          incArmour += Number(mAe[1]);
          incEvasion += Number(mAe[1]);
        }
      }

      const mAllMax = /\+(\d+)% to all maximum Elemental Resistances/i.exec(l);
      if (mAllMax) {
        const v = Number(mAllMax[1]);
        maxFireBonus += v; maxColdBonus += v; maxLightBonus += v;
      }
      const mMaxFire = /\+(\d+)% to maximum Fire Resistance/i.exec(l);
      if (mMaxFire) maxFireBonus += Number(mMaxFire[1]);
      const mMaxCold = /\+(\d+)% to maximum Cold Resistance/i.exec(l);
      if (mMaxCold) maxColdBonus += Number(mMaxCold[1]);
      const mMaxLight = /\+(\d+)% to maximum Lightning Resistance/i.exec(l);
      if (mMaxLight) maxLightBonus += Number(mMaxLight[1]);
      const mMaxChaos = /\+(\d+)% to maximum Chaos Resistance/i.exec(l);
      if (mMaxChaos) maxChaosBonus += Number(mMaxChaos[1]);

      const mPdr = /(\d+)% additional Physical Damage Reduction/i.exec(l);
      if (mPdr) flatPdr += Number(mPdr[1]);
    }
  };

  parseGlobalLines(treeLines, true);

  // 2. Equipped gear local + global defenses
  let gearArmour = 0;
  let gearEvasion = 0;
  let gearEs = 0;

  for (const item of gear.items) {
    if (item.base.type === 'Flask') continue;
    const lines = [...item.implicits, ...item.explicits];
    const isArmourSlot = Boolean(item.base.armour);

    if (isArmourSlot && item.base.armour) {
      const a = item.base.armour;
      const qual = (item.quality ?? 0) / 100;
      let baseArm = a.ArmourBaseMax ? (a.ArmourBaseMin + a.ArmourBaseMax) / 2 : 0;
      let baseEva = a.EvasionBaseMax ? (a.EvasionBaseMin + a.EvasionBaseMax) / 2 : 0;
      let baseEs = a.EnergyShieldBaseMax ? (a.EnergyShieldBaseMin + a.EnergyShieldBaseMax) / 2 : 0;

      let locFlatArm = 0, locIncArm = 0;
      let locFlatEva = 0, locIncEva = 0;
      let locFlatEs = 0, locIncEs = 0;

      for (const raw of lines) {
        const l = raw.replace(/\{[^}]+\}/g, '');
        const mArm = /^\+(\d+) to Armour$/i.exec(l);
        if (mArm) locFlatArm += Number(mArm[1]);
        const mEva = /^\+(\d+) to Evasion Rating$/i.exec(l);
        if (mEva) locFlatEva += Number(mEva[1]);
        const mEs = /^\+(\d+) to maximum Energy Shield$/i.exec(l);
        if (mEs) locFlatEs += Number(mEs[1]);

        const mIncA = /^(\d+)% increased Armour$/i.exec(l);
        if (mIncA) locIncArm += Number(mIncA[1]);
        const mIncE = /^(\d+)% increased Evasion Rating$/i.exec(l);
        if (mIncE) locIncEva += Number(mIncE[1]);
        const mIncS = /^(\d+)% increased Energy Shield$/i.exec(l);
        if (mIncS) locIncEs += Number(mIncS[1]);

        const mIncAE = /^(\d+)% increased Armour and Evasion$/i.exec(l);
        if (mIncAE) { locIncArm += Number(mIncAE[1]); locIncEva += Number(mIncAE[1]); }
        const mIncAS = /^(\d+)% increased Armour and Energy Shield$/i.exec(l);
        if (mIncAS) { locIncArm += Number(mIncAS[1]); locIncEs += Number(mIncAS[1]); }
        const mIncES = /^(\d+)% increased Evasion and Energy Shield$/i.exec(l);
        if (mIncES) { locIncEva += Number(mIncES[1]); locIncEs += Number(mIncES[1]); }
      }

      if (baseArm > 0 || locFlatArm > 0) {
        gearArmour += Math.round((baseArm + locFlatArm) * (1 + qual + locIncArm / 100));
      }
      if (baseEva > 0 || locFlatEva > 0) {
        gearEvasion += Math.round((baseEva + locFlatEva) * (1 + qual + locIncEva / 100));
      }
      if (baseEs > 0 || locFlatEs > 0) {
        gearEs += Math.round((baseEs + locFlatEs) * (1 + qual + locIncEs / 100));
      }

      // Parse non-local life/max-res/pdr/global mods on armour slot
      parseGlobalLines(
        lines.filter((x) => !/^\+\d+ to (?:Armour|Evasion Rating|maximum Energy Shield)$/i.test(x)),
        false,
      );
    } else {
      parseGlobalLines(lines, false);
    }
  }

  // 3. Active Auras & Supports
  const activeGemNames = new Set<string>();
  for (const grp of skills.groups) {
    for (const gi of grp.gems) activeGemNames.add(gi.gem.name);
  }
  const hasDetermination = activeGemNames.has('Determination');
  const hasGrace = activeGemNames.has('Grace');
  const hasDiscipline = activeGemNames.has('Discipline');
  const hasArcticArmour = activeGemNames.has('Arctic Armour');
  const hasFortify = activeGemNames.has('Fortify');

  if (hasDetermination) gearArmour += 2042;
  if (hasGrace) gearEvasion += 2575;
  if (hasDiscipline) flatEs += 217;

  // 4. Final Life & ES pools
  const baseLife = 38 + 12 * arch.options.level;
  const strLife = noStrLife ? 0 : Math.floor(gear.attributes.str / 2);
  const rawMaxLife = Math.round((baseLife + strLife + flatLife) * (1 + incLife / 100) * moreLifeMult);
  const maxLife = hasCI ? 1 : rawMaxLife;

  const intEsBonus = Math.floor(gear.attributes.int / 5);
  const totalFlatEs = gearEs + flatEs;
  const maxEs = Math.round(totalFlatEs * (1 + (incEs + intEsBonus) / 100));

  // 5. Final Armour & Evasion
  let totalEvasion = Math.round(gearEvasion * (1 + incEvasion / 100) * (hasGrace ? 1.29 : 1));
  let totalArmour = Math.round(gearArmour * (1 + incArmour / 100) * (hasDetermination ? 1.49 : 1));
  if (hasIR) {
    totalArmour += totalEvasion;
    totalEvasion = 0;
  }

  // 6. Effective Resistances & Max Hits
  const capFire = Math.min(90, 75 + maxFireBonus);
  const capCold = Math.min(90, 75 + maxColdBonus);
  const capLight = Math.min(90, 75 + maxLightBonus);
  const capChaos = Math.min(90, 75 + maxChaosBonus);

  const effFire = Math.min(capFire, gear.resists.fire);
  const effCold = Math.min(capCold, gear.resists.cold);
  const effLight = Math.min(capLight, gear.resists.lightning);
  const effEleRes = Math.min(effFire, effCold, effLight);
  const effChaosRes = hasCI ? 100 : Math.min(capChaos, gear.resists.chaos);
  const maxEleRes = Math.min(capFire, capCold, capLight);

  const hitPool = hasCI ? maxEs : (hasEB ? maxLife : maxLife + maxEs);
  const fortifyMult = hasFortify ? 0.8 : 1.0;
  const physMult = fortifyMult * (hasArcticArmour ? 0.8 : 1.0);
  const pdrFrac = Math.min(0.75, flatPdr / 100);

  // Solve M * (1 - min(0.90, pdrFrac + A / (A + 5*M))) * physMult = hitPool
  let lo = 0;
  let hi = 500000;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const armMit = totalArmour > 0 ? totalArmour / (totalArmour + 5 * mid) : 0;
    const totalMit = Math.min(0.9, pdrFrac + armMit);
    const dmgTaken = mid * (1 - totalMit) * physMult;
    if (dmgTaken <= hitPool) lo = mid;
    else hi = mid;
  }
  const physMaxHit = Math.round(lo);

  const eleTakenFrac = Math.max(0.05, (1 - effEleRes / 100) * fortifyMult);
  const eleMaxHit = Math.round(hitPool / eleTakenFrac);

  let chaosMaxHit: number | null = null;
  if (!hasCI) {
    const chaosTakenFrac = Math.max(0.05, (1 - effChaosRes / 100) * fortifyMult);
    chaosMaxHit = Math.round(hitPool / chaosTakenFrac);
  }

  return {
    lifePct: incLife,
    esPct: incEs,
    maxLife,
    maxEs,
    armour: totalArmour,
    evasion: totalEvasion,
    maxEleRes,
    effEleRes,
    effChaosRes,
    physMaxHit,
    eleMaxHit,
    chaosMaxHit,
  };
}
