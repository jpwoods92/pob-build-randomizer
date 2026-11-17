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
  maxMana: number;
  armour: number;
  evasion: number;
  maxEleRes: number;
  effEleRes: number;
  effChaosRes: number;
  physMaxHit: number;
  eleMaxHit: number;
  chaosMaxHit: number | null; // null = Immune (Chaos Inoculation)
}

export interface ProjectedOffense {
  totalDps: number;
  hitDmg: number;
  rateLabel: string;
  incDamagePct: number;
  critChancePct: number;
  critMultiPct: number;
  skillLevel: number;
  dpsMode: 'Hit DPS' | 'DoT DPS' | 'Totem DPS' | 'Minion DPS' | 'Trap/Mine DPS' | 'Support';
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
  const hasBM = keystones.has('Blood Magic');

  // 1. Gather passive tree modifiers
  let flatLife = arch.bandit === 'Oak' ? 40 : 0;
  let incLife = 0;
  let moreLifeMult = 1;
  let flatEs = 0;
  let incEs = 0;
  let flatMana = 0;
  let incMana = 0;
  let incArmour = 0;
  let incEvasion = 0;
  let maxFireBonus = 0;
  let maxColdBonus = 0;
  let maxLightBonus = 0;
  let maxChaosBonus = 0;
  let flatPdr = arch.pantheonMajor === 'Solaris' ? 6 : 0;
  let noStrLife = false;
  let physToFire = 0;
  let physToCold = 0;
  let physToLight = 0;
  let physToChaos = 0;
  let fireToCold = 0;
  let fireToLight = 0;
  let fireToChaos = 0;
  let coldToFire = 0;
  let coldToLight = 0;
  let coldToChaos = 0;
  let lightToFire = 0;
  let lightToCold = 0;
  let lightToChaos = 0;

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

      const mFlatMana = /^\+(\d+) to maximum Mana$/i.exec(l);
      if (mFlatMana) flatMana += Number(mFlatMana[1]);

      const mIncMana = /(\d+)% increased maximum Mana\b/i.exec(l);
      if (mIncMana && !/minions/i.test(l)) incMana += Number(mIncMana[1]);

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

      const mTaken = /(\d+)% of (.+?) Damage(?: from Hits)? taken as (Fire|Cold|Lightning|Chaos) Damage/i.exec(l);
      if (mTaken) {
        const pct = Number(mTaken[1]) / 100;
        const src = mTaken[2].toLowerCase();
        const dst = mTaken[3].toLowerCase();
        if (src.includes('physical')) {
          if (dst === 'fire') physToFire += pct;
          else if (dst === 'cold') physToCold += pct;
          else if (dst === 'lightning') physToLight += pct;
          else if (dst === 'chaos') physToChaos += pct;
        }
        if (src.includes('elemental')) {
          if (dst === 'chaos') { fireToChaos += pct; coldToChaos += pct; lightToChaos += pct; }
          else if (dst === 'fire') { coldToFire += pct; lightToFire += pct; }
          else if (dst === 'cold') { fireToCold += pct; lightToCold += pct; }
          else if (dst === 'lightning') { fireToLight += pct; coldToLight += pct; }
        } else {
          if (src.includes('fire')) {
            if (dst === 'cold') fireToCold += pct;
            else if (dst === 'lightning') fireToLight += pct;
            else if (dst === 'chaos') fireToChaos += pct;
          }
          if (src.includes('cold')) {
            if (dst === 'fire') coldToFire += pct;
            else if (dst === 'lightning') coldToLight += pct;
            else if (dst === 'chaos') coldToChaos += pct;
          }
          if (src.includes('lightning')) {
            if (dst === 'fire') lightToFire += pct;
            else if (dst === 'cold') lightToCold += pct;
            else if (dst === 'chaos') lightToChaos += pct;
          }
        }
      }
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
  if (activeGemNames.has('Purity of Fire')) maxFireBonus += 4;
  if (activeGemNames.has('Purity of Ice')) maxColdBonus += 4;
  if (activeGemNames.has('Purity of Lightning')) maxLightBonus += 4;

  // 4. Final Life & ES pools
  const baseLife = 38 + 12 * arch.options.level;
  const strLife = noStrLife ? 0 : Math.floor(gear.attributes.str / 2);
  const rawMaxLife = Math.round((baseLife + strLife + flatLife) * (1 + incLife / 100) * moreLifeMult);
  const maxLife = hasCI ? 1 : rawMaxLife;

  const intEsBonus = Math.floor(gear.attributes.int / 5);
  const totalFlatEs = gearEs + flatEs;
  const maxEs = Math.round(totalFlatEs * (1 + (incEs + intEsBonus) / 100));

  const baseMana = 34 + 6 * arch.options.level;
  const intMana = Math.floor(gear.attributes.int / 2);
  const maxMana = hasBM ? 0 : Math.round((baseMana + intMana + flatMana) * (1 + incMana / 100));

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

  // Normalize damage-taken conversions (PoE caps each incoming damage type's conversion at 100%)
  const normTaken = (parts: number[]): [number, number, number, number] => {
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum <= 1) return [parts[0], parts[1], parts[2], parts[3]];
    return [parts[0] / sum, parts[1] / sum, parts[2] / sum, parts[3] / sum];
  };
  const [p2f, p2c, p2l, p2ch] = normTaken([physToFire, physToCold, physToLight, physToChaos]);
  const pRem = Math.max(0, 1 - (p2f + p2c + p2l + p2ch));

  // Solve converted Phys + remaining Armour-mitigated Phys = hitPool
  let lo = 0;
  let hi = 1000000;
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    const rawPhys = mid * pRem;
    const armMit = totalArmour > 0 && rawPhys > 0 ? totalArmour / (totalArmour + 5 * rawPhys) : 0;
    const totalMit = Math.min(0.9, pdrFrac + armMit);
    const physDmgTaken = rawPhys * (1 - totalMit) * physMult;
    const convDmgTaken = mid * fortifyMult * (
      p2f * (1 - effFire / 100) +
      p2c * (1 - effCold / 100) +
      p2l * (1 - effLight / 100) +
      p2ch * (1 - effChaosRes / 100)
    );
    if (physDmgTaken + convDmgTaken <= hitPool) lo = mid;
    else hi = mid;
  }
  const physMaxHit = Math.round(lo);

  const calcEleTakenFrac = (selfEff: number, toF: number, toC: number, toL: number, toCh: number, isSelf: 'f' | 'c' | 'l') => {
    const sum = toF + toC + toL + toCh;
    const scale = sum > 1 ? 1 / sum : 1;
    const f = toF * scale, c = toC * scale, l = toL * scale, ch = toCh * scale;
    const rem = Math.max(0, 1 - (f + c + l + ch));
    const taken = rem * (1 - selfEff / 100)
      + (isSelf === 'f' ? 0 : f * (1 - effFire / 100))
      + (isSelf === 'c' ? 0 : c * (1 - effCold / 100))
      + (isSelf === 'l' ? 0 : l * (1 - effLight / 100))
      + ch * (1 - effChaosRes / 100);
    return Math.max(0.05, taken * fortifyMult);
  };
  const fireMaxHit = hitPool / calcEleTakenFrac(effFire, 0, fireToCold, fireToLight, fireToChaos, 'f');
  const coldMaxHit = hitPool / calcEleTakenFrac(effCold, coldToFire, 0, coldToLight, coldToChaos, 'c');
  const lightMaxHit = hitPool / calcEleTakenFrac(effLight, lightToFire, lightToCold, 0, lightToChaos, 'l');
  const eleMaxHit = Math.round(Math.min(fireMaxHit, coldMaxHit, lightMaxHit));

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
    maxMana,
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

export function computeProjectedOffense(
  data: GameData,
  arch: BuildArchetype,
  tree: GeneratedTree,
  skills: GeneratedSkills,
  gear: GeneratedGear,
): ProjectedOffense {
  if (arch.damageStyle === 'link_support') {
    return {
      totalDps: 0,
      hitDmg: 0,
      rateLabel: 'Link Buff',
      incDamagePct: 0,
      critChancePct: 0,
      critMultiPct: 150,
      skillLevel: skills.groups[0]?.gems[0]?.level ?? 20,
      dpsMode: 'Support',
    };
  }

  const mainGroup = skills.groups[0];
  const mainGem = mainGroup?.gems[0];
  const supports = mainGroup ? mainGroup.gems.slice(1) : [];
  let skillLevel = mainGem?.level ?? 20;

  const treeLines = collectTreeLines(data, tree);
  const gearLines: string[] = [];
  for (const item of gear.items) {
    if (item.base.type === 'Flask') continue;
    gearLines.push(...item.implicits, ...item.explicits);
  }
  const allLines = [...treeLines, ...gearLines];

  const keystones = new Set(tree.summary.keystones);
  const activeGemNames = new Set<string>();
  for (const grp of skills.groups) {
    for (const gi of grp.gems) activeGemNames.add(gi.gem.name);
  }

  let incDamage = 0;
  let incAtkSpeed = 0;
  let incCastSpeed = 0;
  let incCrit = 0;
  let critMultiBonus = 0;
  let dotMultiBonus = 0;
  let addedFlatSpell = 0;
  let addedFlatAttack = 0;
  let globalWeaponCritBase = 0;
  let maxTotems = arch.damageStyle === 'totem' ? (keystones.has('Ancestral Bond') ? 2 : 1) + (supports.some((s) => s.gem.name.includes('Multiple Totems')) ? 2 : 0) : 1;

  for (const raw of allLines) {
    const l = raw.replace(/\{[^}]+\}/g, '');
    const tl = l.toLowerCase();

    const mGemLvl = /\+(\d+) to level of all (.+?) skill gems/i.exec(l);
    if (mGemLvl) {
      const tag = mGemLvl[2].toLowerCase();
      const hitsSkill =
        tag === 'skill' ||
        (tag === 'spell' && arch.damageStyle !== 'attack') ||
        (tag === 'minion' && arch.damageStyle === 'minion') ||
        arch.elements.some((el) => tag.includes(el));
      if (hitsSkill) skillLevel += Number(mGemLvl[1]);
    }

    const mIncDmg = /(\d+)% increased ([^.]+?damage[^.]*)/i.exec(l);
    if (mIncDmg) {
      const val = Number(mIncDmg[1]);
      const kind = mIncDmg[2].toLowerCase();
      if (/taken|reflected|with ailments/.test(kind) && arch.damageStyle !== 'dot') {
        // Skip ailments-only for pure hit unless dot
      } else if (/minion/.test(kind)) {
        if (arch.damageStyle === 'minion') incDamage += val;
      } else if (/totem/.test(kind)) {
        if (arch.damageStyle === 'totem') incDamage += val;
      } else if (/trap|mine/.test(kind)) {
        if (arch.damageStyle === 'trap_mine') incDamage += val;
      } else if (/spell/.test(kind)) {
        if (arch.damageStyle !== 'attack' && arch.damageStyle !== 'minion') incDamage += val;
      } else if (/attack/.test(kind)) {
        if (arch.damageStyle === 'attack') incDamage += val;
      } else if (/damage over time|burning/.test(kind)) {
        if (arch.damageStyle === 'dot') incDamage += val;
      } else if (/physical|fire|cold|lightning|chaos|elemental|projectile|area|melee|wand|bow|sword|axe|mace|staff|claw|dagger/.test(kind)) {
        const eleHit = arch.elements.some((e) => kind.includes(e)) || (kind.includes('elemental') && arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning'));
        const kwHit = arch.statKeywords.some((kw) => kind.includes(kw)) || (kind.includes(arch.weaponClass));
        if ((eleHit || kwHit || kind === 'damage') && arch.damageStyle !== 'minion') incDamage += val;
      } else if (kind === 'damage' && arch.damageStyle !== 'minion') {
        incDamage += val;
      }
    }

    const mAtkSpd = /(\d+)% increased attack speed/i.exec(l);
    if (mAtkSpd && !/minion/.test(tl)) incAtkSpeed += Number(mAtkSpd[1]);

    const mCastSpd = /(\d+)% increased cast speed/i.exec(l);
    if (mCastSpd) incCastSpeed += Number(mCastSpd[1]);

    const mCrit = /(\d+)% increased (?:global )?critical strike chance/i.exec(l);
    if (mCrit && !/minion/.test(tl)) incCrit += Number(mCrit[1]);

    const mMulti = /\+(\d+)% to (?:global )?critical strike multiplier/i.exec(l);
    if (mMulti) critMultiBonus += Number(mMulti[1]);

    const mDotMulti = /\+(\d+)% to .*damage over time multiplier/i.exec(l);
    if (mDotMulti) dotMultiBonus += Number(mDotMulti[1]);

    const mAdds = /adds (\d+) to (\d+) (fire|cold|lightning|physical|chaos) damage(?: to (spells|attacks))?/i.exec(l);
    if (mAdds) {
      const avg = (Number(mAdds[1]) + Number(mAdds[2])) / 2;
      const elem = mAdds[3].toLowerCase();
      const target = mAdds[4]?.toLowerCase();
      if (arch.elements.includes(elem as BuildArchetype['elements'][number]) || elem === 'physical') {
        if (target === 'spells' && arch.damageStyle !== 'attack') addedFlatSpell += avg;
        else if (target === 'attacks' && arch.damageStyle === 'attack') addedFlatAttack += avg;
      }
    }
  }

  // Account for Strength melee / Iron Grip / Iron Will
  const strPctBonus = Math.floor(gear.attributes.str / 5);
  if (arch.damageStyle === 'attack' && (!arch.statKeywords.includes('projectile') || keystones.has('Iron Grip'))) {
    incDamage += strPctBonus;
  } else if (keystones.has('Iron Will') && arch.damageStyle === 'spell') {
    incDamage += strPctBonus;
  }

  // Weapon base DPS for attacks (or Weapon 1 + Weapon 2 average for dual_wield)
  const w1 = gear.items[gear.slotMap['Weapon 1']];
  const w2 = gear.slotMap['Weapon 2'] ? gear.items[gear.slotMap['Weapon 2']] : undefined;
  const computeWeaponProfile = (item: typeof w1) => {
    if (!item?.base.weapon) return { avgDmg: 85, aps: 1.5, crit: 6.0 };
    const wb = item.base.weapon;
    const avgPhys = ((wb.PhysicalMin ?? 0) + (wb.PhysicalMax ?? 0)) / 2;
    let locIncPhys = (item.quality ?? 0);
    let locFlatPhys = 0;
    let locFlatEle = 0;
    let locIncAps = 0;
    let locIncCrit = 0;
    for (const raw of [...item.implicits, ...item.explicits]) {
      const l = raw.replace(/\{[^}]+\}/g, '');
      const mIncP = /^(\d+)% increased physical damage$/i.exec(l);
      if (mIncP) locIncPhys += Number(mIncP[1]);
      const mFlP = /^adds (\d+) to (\d+) physical damage$/i.exec(l);
      if (mFlP) locFlatPhys += (Number(mFlP[1]) + Number(mFlP[2])) / 2;
      const mFlE = /^adds (\d+) to (\d+) (fire|cold|lightning|chaos) damage$/i.exec(l);
      if (mFlE) locFlatEle += (Number(mFlE[1]) + Number(mFlE[2])) / 2;
      const mAps = /^(\d+)% increased attack speed$/i.exec(l);
      if (mAps) locIncAps += Number(mAps[1]);
      const mCr = /^(\d+)% increased critical strike chance$/i.exec(l);
      if (mCr) locIncCrit += Number(mCr[1]);
    }
    const scaledPhys = (avgPhys + locFlatPhys) * (1 + locIncPhys / 100);
    return {
      avgDmg: scaledPhys + locFlatEle,
      aps: (wb.AttackRateBase ?? 1.4) * (1 + locIncAps / 100),
      crit: (wb.CritChanceBase ?? 5) * (1 + locIncCrit / 100),
    };
  };

  let baseHit = 0;
  let hitsPerSec = 1;
  if (arch.damageStyle === 'attack') {
    const p1 = computeWeaponProfile(w1);
    const p2 = arch.weaponSetup === 'dual_wield' && w2?.base.weapon ? computeWeaponProfile(w2) : undefined;
    const wpAvg = p2 ? (p1.avgDmg + p2.avgDmg) / 2 : p1.avgDmg;
    const wpAps = p2 ? ((p1.aps + p2.aps) / 2) * 1.1 : p1.aps;
    globalWeaponCritBase = p2 ? (p1.crit + p2.crit) / 2 : p1.crit;
    baseHit = (wpAvg + addedFlatAttack) * 1.75; // ~175% average attack effectiveness
    hitsPerSec = wpAps * (1 + incAtkSpeed / 100);
  } else {
    // Spell / Totem / Trap / Mine / Minion / DoT base scaling by effective gem level
    const lvlScale = Math.pow(1.105, skillLevel - 20);
    const rawSpellBase = (arch.damageStyle === 'dot' ? 1450 : 1150) * lvlScale;
    baseHit = rawSpellBase + addedFlatSpell * 1.15;
    globalWeaponCritBase = 6.0;
    const baseCastRate = arch.damageStyle === 'trap_mine' ? 2.1 : 1.45;
    hitsPerSec = baseCastRate * (1 + incCastSpeed / 100);
    if (arch.damageStyle === 'minion') {
      baseHit = 1600 * lvlScale;
      hitsPerSec = 1.65 * (1 + (activeGemNames.has('Haste') ? 0.18 : 0));
      incDamage = Math.max(incDamage, 80); // base minion tree + bone/spirit baseline
    }
  }

  // Support gem More multiplier
  let moreMult = 1;
  for (const sg of supports) {
    const sn = sg.gem.name;
    const isAwk = sg.gem.tags.includes('awakened');
    if (sn === 'Spell Echo' || sn === 'Multistrike') moreMult *= 1.38;
    else if (sn === 'Empower') {
      baseHit *= Math.pow(1.105, Math.min(4, Math.max(1, sg.level - 1)));
    } else if (/Multiple Projectiles|Volley|Chain|Fork|Pierce|Increased Area/.test(sn)) {
      moreMult *= isAwk ? 1.18 : 1.06;
    } else if (/Lifetap|Inspiration|Fortify/.test(sn)) {
      moreMult *= 1.24;
    } else {
      moreMult *= isAwk ? 1.42 : 1.33;
    }
  }

  // Aura More multipliers
  if (activeGemNames.has('Hatred')) moreMult *= 1.25;
  if (activeGemNames.has('Anger')) moreMult *= 1.18;
  if (activeGemNames.has('Wrath')) moreMult *= 1.21;
  if (activeGemNames.has('Pride')) moreMult *= 1.28;
  if (activeGemNames.has('Zealotry')) moreMult *= 1.18;
  if (activeGemNames.has('Malevolence')) moreMult *= 1.21;
  if (activeGemNames.has('Haste')) hitsPerSec *= 1.14;
  if (activeGemNames.has('Precision')) incCrit += 55;
  if (activeGemNames.has('Summon Skitterbots')) moreMult *= 1.16;
  if (activeGemNames.has('Herald of Ash') || activeGemNames.has('Herald of Ice') || activeGemNames.has('Herald of Thunder') || activeGemNames.has('Herald of Purity')) {
    moreMult *= 1.10;
  }

  // Keystones
  if (keystones.has('Elemental Overload')) moreMult *= 1.40;
  if (keystones.has('Precise Technique')) moreMult *= 1.40;
  if (keystones.has('Point Blank')) moreMult *= 1.20;

  // Crit vs DoT multi
  let critChancePct = 0;
  let critMultiPct = 150;
  let critExpectedMult = 1.0;
  if (arch.critMode === 'crit') {
    critChancePct = Math.min(100, Math.round(globalWeaponCritBase * (1 + incCrit / 100)));
    critMultiPct = 150 + critMultiBonus;
    if (arch.damageStyle === 'dot' && keystones.has('Perfect Agony')) {
      dotMultiBonus += critMultiBonus;
    } else {
      critExpectedMult = 1 + (critChancePct / 100) * ((critMultiPct - 100) / 100);
    }
  }

  const dotMult = arch.damageStyle === 'dot' ? 1 + dotMultiBonus / 100 : 1;
  const avgHit = Math.round(baseHit * (1 + incDamage / 100) * moreMult * critExpectedMult * dotMult);
  const rawDps = arch.damageStyle === 'dot'
    ? avgHit
    : Math.round(avgHit * hitsPerSec * (arch.damageStyle === 'totem' ? maxTotems : arch.damageStyle === 'minion' ? 4 : 1));

  const dpsMode: ProjectedOffense['dpsMode'] =
    arch.damageStyle === 'dot' ? 'DoT DPS'
      : arch.damageStyle === 'totem' ? 'Totem DPS'
        : arch.damageStyle === 'minion' ? 'Minion DPS'
          : arch.damageStyle === 'trap_mine' ? 'Trap/Mine DPS'
            : 'Hit DPS';

  const rateLabel = arch.damageStyle === 'dot'
    ? `+${dotMultiBonus}% DoT Multi`
    : arch.damageStyle === 'totem'
      ? `${maxTotems} Totems · ${hitsPerSec.toFixed(2)}/s`
      : `${hitsPerSec.toFixed(2)}/s`;

  return {
    totalDps: rawDps,
    hitDmg: avgHit,
    rateLabel,
    incDamagePct: incDamage,
    critChancePct,
    critMultiPct,
    skillLevel,
    dpsMode,
  };
}
