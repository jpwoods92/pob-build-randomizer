import type { GameData, TreeData, TreeNode } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { Rng } from './rng.ts';
import { allocateClusterJewelsForTree, type GeneratedClusterJewel } from './cluster.ts';

export interface GeneratedTree {
  classId: number;
  ascendClassId: number;
  nodes: number[];
  ascendancyNodes: number[];
  masteryEffects: Record<number, number>;
  jewelSockets: number[];
  clusterNodes?: Record<number, TreeNode>;
  clusterJewels?: GeneratedClusterJewel[];
  pointsUsed: number;
  pointsBudget: number;
  ascPointsUsed: number;
  attributes: { str: number; dex: number; int: number };
  summary: {
    lifePct: number;
    esPct: number;
    keystones: string[];
    notables: string[];
    masteries: { nodeId: number; name: string; effectId: number; text: string }[];
  };
  url: string;
}

export function tallyNodeAttributes(
  node: TreeNode | undefined,
  attrs: { str: number; dex: number; int: number },
): void {
  if (!node) return;
  if (node.gs) attrs.str += node.gs;
  if (node.gd) attrs.dex += node.gd;
  if (node.gi) attrs.int += node.gi;
  for (const s of node.s ?? []) {
    const ms = /\+(\d+) to Strength/.exec(s);
    if (ms) attrs.str += Number(ms[1]);
    const md = /\+(\d+) to Dexterity/.exec(s);
    if (md) attrs.dex += Number(md[1]);
    const mi = /\+(\d+) to Intelligence/.exec(s);
    if (mi) attrs.int += Number(mi[1]);
    const ma = /\+(\d+) to all Attributes/.exec(s);
    if (ma) {
      const v = Number(ma[1]);
      attrs.str += v; attrs.dex += v; attrs.int += v;
    }
  }
}

export function collectAllocatedTreeLines(data: GameData, tree: GeneratedTree): string[] {
  const lines: string[] = [];
  for (const id of tree.nodes) {
    const n = tree.clusterNodes?.[id] ?? data.tree.nodes[id];
    if (!n) continue;
    if (n.s) lines.push(...n.s);
    if (n.t === 'mastery' && tree.masteryEffects[id]) {
      const eff = n.me?.find((m) => m.e === tree.masteryEffects[id]);
      if (eff) lines.push(...eff.s);
    }
  }
  return lines;
}

const PATH_TO_CLASS_START: Record<string, number> = {
  'Path of the Scion': 0,
  'Path of the Marauder': 1,
  'Path of the Ranger': 2,
  'Path of the Witch': 3,
  'Path of the Duelist': 4,
  'Path of the Templar': 5,
  'Path of the Shadow': 6,
};

const WEAPON_PATTERNS: { wc: string; re: RegExp; oneHandMelee?: boolean }[] = [
  { wc: 'axe', re: /\baxes?\b/, oneHandMelee: true },
  { wc: 'sword', re: /\bswords?\b/, oneHandMelee: true },
  { wc: 'mace', re: /\bmaces?\b|\bsceptres?\b/, oneHandMelee: true },
  { wc: 'claw', re: /\bclaws?\b/, oneHandMelee: true },
  { wc: 'dagger', re: /\bdaggers?\b/, oneHandMelee: true },
  { wc: 'wand', re: /\bwands?\b/ },
  { wc: 'staff', re: /\bstaves\b|\bstaff\b/ },
  { wc: 'bow', re: /\bbows?\b|\bquivers?\b/ },
];

function isWeaponCompatible(wc: string, arch: BuildArchetype): boolean {
  if (arch.countsAsAllOneHandMelee) {
    return wc === 'sword' || wc === 'axe' || wc === 'mace' || wc === 'claw' || wc === 'dagger';
  }
  return wc === arch.weaponClass;
}

function hasIncompatibleWeaponOrSetup(text: string, arch: BuildArchetype): boolean {
  const mentioned = WEAPON_PATTERNS.filter((p) => p.re.test(text));
  if (mentioned.length > 0) {
    // Allow if at least one mentioned weapon matches our weaponClass (or Varunastra 1H melee)
    const anyMatch = mentioned.some((p) => isWeaponCompatible(p.wc, arch));
    if (!anyMatch) return true;
    // Non-attack builds shouldn't take melee/bow weapon attack clusters (except caster wands/staves/daggers/sceptres)
    if (arch.damageStyle !== 'attack' && mentioned.every((p) => p.wc === 'axe' || p.wc === 'sword' || p.wc === 'claw' || p.wc === 'bow')) {
      return true;
    }
  }
  if (/\bdual wielding\b/.test(text) && arch.weaponSetup !== 'dual_wield') return true;
  if (/while holding a shield|\bwith shields\b|shield defence/.test(text) && !arch.weaponSetup.includes('shield')) return true;
  if (/\btwo handed\b/.test(text) && arch.weaponSetup !== 'two_hand' && arch.weaponSetup !== 'staff') return true;
  return false;
}

function isMasteryAllowed(name: string, arch: BuildArchetype): boolean {
  switch (name) {
    case 'Axe Mastery': return isWeaponCompatible('axe', arch) && arch.damageStyle === 'attack';
    case 'Sword Mastery': return isWeaponCompatible('sword', arch) && arch.damageStyle === 'attack';
    case 'Mace Mastery': return isWeaponCompatible('mace', arch) && arch.damageStyle === 'attack';
    case 'Claw Mastery': return isWeaponCompatible('claw', arch) && arch.damageStyle === 'attack';
    case 'Dagger Mastery': return isWeaponCompatible('dagger', arch) && (arch.damageStyle === 'attack' || arch.damageStyle === 'spell' || arch.damageStyle === 'dot');
    case 'Wand Mastery': return isWeaponCompatible('wand', arch);
    case 'Staff Mastery': return isWeaponCompatible('staff', arch);
    case 'Bow Mastery': return isWeaponCompatible('bow', arch);
    case 'Attack Mastery':
    case 'Accuracy Mastery':
    case 'Rage Mastery':
      return arch.damageStyle === 'attack';
    case 'Caster Mastery':
      return arch.damageStyle === 'spell' || arch.damageStyle === 'totem' || arch.damageStyle === 'trap_mine' || arch.damageStyle === 'dot';
    case 'Trap Mastery': return arch.trapOrMine === 'trap';
    case 'Mine Mastery': return arch.trapOrMine === 'mine';
    case 'Totem Mastery': return arch.damageStyle === 'totem';
    case 'Minion Defence Mastery':
    case 'Minion Offence Mastery':
      return arch.damageStyle === 'minion';
    case 'Brand Mastery': return arch.statKeywords.includes('brand');
    case 'Dual Wielding Mastery': return arch.weaponSetup === 'dual_wield';
    case 'Shield Mastery': return arch.weaponSetup.includes('shield');
    case 'Two Hand Mastery': return arch.weaponSetup === 'two_hand' || arch.weaponSetup === 'staff';
    case 'Life Mastery': return arch.defenseStyle !== 'es';
    case 'Energy Shield Mastery': return arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid';
    case 'Critical Mastery': return arch.critMode === 'crit';
    case 'Impale Mastery': return arch.damageStyle === 'attack' && arch.elements.includes('physical');
    case 'Bleeding Mastery': return arch.damageStyle === 'dot' && arch.elements.includes('physical');
    case 'Poison Mastery': return arch.elements.includes('chaos') || arch.damageStyle === 'dot';
    case 'Fire Mastery': return arch.elements.includes('fire');
    case 'Cold Mastery': return arch.elements.includes('cold');
    case 'Lightning Mastery': return arch.elements.includes('lightning');
    case 'Chaos Mastery': return arch.elements.includes('chaos');
    case 'Physical Mastery': return arch.elements.includes('physical');
    case 'Damage Over Time Mastery': return arch.damageStyle === 'dot';
    case 'Projectile Mastery': return arch.statKeywords.includes('projectile');
    case 'Fortify Mastery': return arch.damageStyle === 'attack';
    case 'Attributes Mastery': return Boolean(arch.statStack);
    case 'Link Mastery': return arch.damageStyle === 'link_support';
    case 'Retaliation Mastery':
    case 'Banner Mastery':
    case 'Warcry Mastery':
    case 'Tincture Mastery':
      return false;
    default:
      return true;
  }
}

export function scoreStatsText(stats: string[] | undefined, arch: BuildArchetype): number {
  if (!stats || stats.length === 0) return 0;
  const text = stats.join(' | ').toLowerCase();
  const isHC = arch.options.leagueMode === 'hardcore';
  const isTrade = arch.options.economy === 'trade';
  let score = 0;

  // Hard anti-synergy filters (wrong weapon, wrong setup, wrong mechanic)
  if (hasIncompatibleWeaponOrSetup(text, arch)) return -120;
  if (arch.damageStyle !== 'minion' && /\bminions?\b/.test(text)) return -100;
  if (arch.damageStyle !== 'totem' && /\btotems?\b/.test(text)) return -100;
  if (arch.trapOrMine !== 'trap' && /\btraps?\b/.test(text)) return -100;
  if (arch.trapOrMine !== 'mine' && /\bmines?\b/.test(text)) return -100;
  if (arch.damageStyle === 'attack' && /\bspell damage\b|\bcast speed\b/.test(text)) return -80;
  if (arch.damageStyle !== 'attack' && /\battack damage\b|\bmelee damage\b|\battack speed\b|\bimpale\b/.test(text)) return -80;
  if (
    arch.defenseStyle === 'es' &&
    /\bmaximum life\b|life regeneration|regenerate .* life|life leech|life gained|life on kill|life on hit|life flask/.test(text) &&
    !/maximum life becomes 1/.test(text) &&
    !/\bminions?\b/.test(text)
  ) {
    return -80;
  }

  const targets = arch.options.targets;
  const hpBoost = (targets?.minHp ?? 0) > 0 ? 28 : 0;
  const physHitBoost = (targets?.minPhysMaxHit ?? 0) > 0 || (targets?.minArmour ?? 0) > 0 ? 24 : 0;
  const eleHitBoost = (targets?.minEleMaxHit ?? 0) > 0 || (targets?.minMaxFireRes ?? 0) > 75 ? 36 : 0;
  const evaBoost = (targets?.minEvasion ?? 0) > 0 || (targets?.minEvadePct ?? 0) > 0 ? 28 : 0;
  const suppBoost = (targets?.minSuppressPct ?? 0) > 0 || (targets?.minDodgePct ?? 0) > 0 ? 35 : 0;
  const chaosBoost = (targets?.minChaosMaxHit ?? 0) > 0 ? 28 : 0;
  const critChanceBoost = (targets?.minCritChancePct ?? 0) > 0 ? 22 : 0;
  const atkBlockBoost = (targets?.minAttackBlockPct ?? 0) > 0 ? 75 : 0;
  const spellBlockBoost = (targets?.minSpellBlockPct ?? 0) > 0 ? 95 : 0;
  const dpsTargetMult = (targets?.minDps ?? 0) > 0 ? 1.45 : 1;

  // Defenses
  if (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid') {
    if (/maximum life/.test(text)) score += (isHC ? 38 : 18) + hpBoost;
    if (/life regeneration|regenerate .* life/.test(text)) score += isHC ? 14 : 6;
    if (/life leech/.test(text)) score += 7;
  } else if (arch.defenseStyle === 'es' && /\bmaximum life\b|life regeneration|regenerate .* life|life leech/.test(text) && !/\bminions?\b/.test(text)) {
    score -= 200;
  }
  if (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') {
    if (/maximum energy shield/.test(text)) score += (isHC ? 34 : 20) + hpBoost;
    if (/energy shield recharge|faster start of energy shield/.test(text)) score += isHC ? 12 : 6;
  }
  const isEvasionBuild = arch.primaryAttr === 'dex' && arch.defenseStyle !== 'es';
  if (/suppress spell damage|chance to suppress spell damage is lucky|of suppressed spell damage/.test(text) && !/instead apply to chance to dodge/.test(text)) {
    score += (isEvasionBuild ? (isHC ? 65 : 22) : (isHC ? 28 : 11)) + suppBoost;
  }
  if (/maximum (all )?(fire|cold|lightning|elemental) resistance/.test(text)) score += (isHC ? 26 : 12) + eleHitBoost;
  if (/maximum chaos resistance/.test(text)) score += arch.defenseStyle === 'es' ? -80 : (isHC ? 22 : 10) + chaosBoost;
  if (/to all elemental resistances|to (fire|cold|lightning) resistance/.test(text)) score += isHC ? 10 : 5;
  if (/chaos resistance/.test(text)) score += arch.defenseStyle === 'es' ? -80 : (isHC ? 28 : 4) + chaosBoost;
  if (/armour/.test(text) && (arch.primaryAttr === 'str' || isHC || physHitBoost > 0)) score += (isHC ? 10 : 4) + (physHitBoost > 0 ? 18 : 0);
  if (/evasion/.test(text) && (arch.primaryAttr === 'dex' || isHC || evaBoost > 0)) score += (isHC ? 9 : 4) + evaBoost;
  if (/chance to block attack damage|maximum chance to block attack damage/.test(text) && (arch.weaponSetup.includes('shield') || arch.weaponSetup === 'dual_wield' || arch.weaponSetup === 'staff')) {
    score += (isHC ? 16 : 8) + atkBlockBoost;
  }
  if (/chance to block spell damage|maximum chance to block spell damage|per 5% chance to block attack damage|overcapped chance to block attack damage/.test(text) && (arch.weaponSetup.includes('shield') || arch.weaponSetup === 'dual_wield' || arch.weaponSetup === 'staff')) {
    score += (isHC ? 16 : 8) + spellBlockBoost;
  }
  if (/reservation efficiency/.test(text)) score += isHC ? 20 : 15;
  if (/fortif/.test(text) && arch.damageStyle === 'attack') score += (isHC ? 18 : 8) + physHitBoost;
  if (/additional physical damage reduction|taken as/.test(text)) score += physHitBoost;
  if (/recoup/.test(text)) score += isHC ? 12 : 5;
  if (/avoid being (shocked|frozen|chilled|ignited)|elemental ailments/.test(text)) score += isHC ? 13 : 5;
  if (/immune to corrupted blood|cannot be inflicted/.test(text)) score += isHC ? 16 : 7;

  // Offense by damage style
  let offScore = 0;
  if (arch.damageStyle === 'attack') {
    if (/attack damage|physical damage with|melee damage|projectile attack|bow damage|with axes|with swords|with maces|with claws|with daggers|with wands/.test(text)) {
      offScore += isHC ? 14 : 18;
    }
    if (/attack speed/.test(text)) offScore += isHC ? 10 : 14;
    if (/accuracy/.test(text) && arch.critMode !== 'non_crit') offScore += 8;
    if (/impale/.test(text) && arch.elements.includes('physical')) offScore += 12;
  } else if (arch.damageStyle === 'spell') {
    if (/spell damage|elemental damage|chaos damage/.test(text)) offScore += isHC ? 12 : 17;
    if (/cast speed/.test(text)) offScore += isHC ? 10 : 14;
    if (/critical strike chance for spells|spell critical/.test(text) && arch.critMode === 'crit') offScore += 14;
  } else if (arch.damageStyle === 'minion') {
    if (/minion/.test(text)) offScore += 26;
    if (/minion.*maximum life/.test(text)) offScore += isHC ? 16 : 8;
    if (/aura/.test(text)) offScore += 8;
  } else if (arch.damageStyle === 'totem') {
    if (/totem/.test(text)) offScore += 24;
    if (/spell damage|attack damage|elemental damage/.test(text)) offScore += 9;
  } else if (arch.damageStyle === 'trap_mine') {
    if (arch.trapOrMine === 'trap' && /\btraps?\b/.test(text)) offScore += 26;
    if (arch.trapOrMine === 'mine' && /\bmines?\b/.test(text)) offScore += 26;
    if (/spell damage|elemental damage|area damage|projectile/.test(text)) offScore += 9;
  } else if (arch.damageStyle === 'dot') {
    if (/damage over time|dot multiplier|ignite|bleed|poison|ailment/.test(text)) offScore += 22;
  } else if (arch.damageStyle === 'link_support') {
    if (/link skills|effect of non-curse auras|mercenary|light radius|skill effect duration/.test(text)) offScore += 28;
    if (/aura/.test(text)) offScore += 12;
  }

  // Crit vs non-crit
  if (arch.critMode === 'crit') {
    if (/critical strike multiplier/.test(text)) offScore += isHC ? 14 : 21;
    if (/critical strike chance/.test(text)) offScore += (isHC ? 11 : 16) + critChanceBoost;
  } else {
    if (/critical strike/.test(text)) score -= 35;
  }
  score += Math.round(offScore * dpsTargetMult);

  // Elements
  for (const el of arch.elements) {
    if (el === 'fire' && /fire damage|burning|ignite|penetrates .* fire/.test(text)) score += 14;
    if (el === 'cold' && /cold damage|chill|freeze|penetrates .* cold/.test(text)) score += 14;
    if (el === 'lightning' && /lightning damage|shock|penetrates .* lightning/.test(text)) score += 14;
    if (el === 'chaos' && /chaos damage|poison|wither/.test(text)) score += 14;
    if (el === 'physical' && /physical damage|bleed|impale/.test(text)) score += 12;
  }
  if (/penetrates .* elemental|exposure/.test(text) && arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning')) {
    score += 15;
  }

  // Weapon / tag specifics
  if (arch.weaponSetup === 'bow_quiver' && /with bows|quiver/.test(text)) score += 16;
  if (arch.weaponSetup === 'two_hand' && /two handed/.test(text)) score += 15;
  if (arch.weaponSetup === 'staff' && /staves/.test(text)) score += 15;
  if (arch.weaponSetup === 'dual_wield' && /dual wielding/.test(text)) score += 15;
  if ((arch.weaponSetup === 'one_hand_shield' || arch.weaponSetup === 'wand_shield') && /holding a shield|shield/.test(text)) score += isHC ? 15 : 9;
  if (arch.statKeywords.includes('projectile') && /projectile/.test(text)) score += 10;
  if (arch.statKeywords.includes('area') && /area of effect|area damage/.test(text)) score += 9;
  if (arch.statKeywords.includes('brand') && /brand/.test(text)) score += 18;

  // Jewel trade bias
  if (isTrade && /jewel/.test(text)) score += 6;

  return score;
}

export const ALL_KEYSTONE_NAMES = [
  'Iron Reflexes', 'Vaal Pact', 'Wind Dancer', 'Chaos Inoculation', 'Bitter Frost',
  'Iron Grip', 'Bloodsoaked Blade', 'Crimson Dance', 'Minion Instability', 'The Agnostic',
  'Arsenal of Vengeance', 'Eternal Youth', 'Elemental Overload', 'Call to Arms', 'Perfect Agony',
  'Conduit', 'Wicked Ward', 'Ghost Reaver', 'Imbalanced Guard', 'Pain Attunement',
  'Resolute Technique', 'Mind Over Matter', 'Ghost Dance', 'Elemental Equilibrium', 'Glancing Blows',
  'Roiling Tempest', 'Unwavering Stance', 'Ancestral Bond', 'Point Blank', 'Runebinder',
  'Hex Master', 'Avatar of Fire', 'Necromantic Aegis', 'Supreme Ego', 'Iron Will',
  'Versatile Combatant', 'Acrobatics', 'Arrow Dancing', 'Eldritch Battery', 'Magebane',
  'The Impaler', 'Blood Magic', 'Divine Shield', 'Solipsism', 'Lethe Shade',
  "Zealot's Oath", 'Precise Technique', 'Voracious Flame',
] as const;

/** Extract player keystones granted by item/mod lines (ignoring minion-only or socketed-gem grants). */
export function extractKeystonesFromLines(lines: string[]): string[] {
  const found = new Set<string>();
  for (const raw of lines) {
    const clean = raw.replace(/\{[^}]+\}/g, '').replace(/\s*\(crafted\)\s*$/i, '').trim();
    if (/^(?:summoned|raised|minions|socketed gems)\b/i.test(clean)) continue;
    if (/supported by .* support/i.test(clean)) continue;
    for (const ks of ALL_KEYSTONE_NAMES) {
      const esc = ks.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (
        new RegExp(`^${esc}$`, 'i').test(clean)
        || new RegExp(`^(?:grants|you have) ${esc}\\b`, 'i').test(clean)
        || new RegExp(`\\bgain ${esc}\\b`, 'i').test(clean)
        || new RegExp(`^${esc} (?:during effect|while )`, 'i').test(clean)
      ) {
        found.add(ks);
      }
    }
  }
  return [...found];
}

export function isKeystoneNameAllowed(
  name: string,
  arch: BuildArchetype,
  manaReservedPct = 80,
  allocatedKeystones?: Set<string>,
  opts?: { fromItem?: boolean; isEvasionBuild?: boolean },
): boolean {
  const isHC = arch.options.leagueMode === 'hardcore';
  const isSpellSkill = arch.damageStyle === 'spell' || (arch.damageStyle === 'totem' && arch.mainSkill.types.includes('Spell'));
  const isAttackSkill = arch.damageStyle === 'attack' || arch.mainSkill.types.includes('Attack');
  const isStrBuild = arch.primaryAttr === 'str' || arch.statStack === 'str';
  const isArmourClass = isStrBuild || arch.classData.name === 'Templar' || arch.classData.name === 'Marauder' || arch.classData.name === 'Duelist';

  switch (name) {
    case 'Chaos Inoculation':
      return arch.defenseStyle === 'es';
    case 'Ancestral Bond':
      return arch.damageStyle === 'totem';
    case 'Runebinder':
      return arch.statKeywords.includes('brand');
    case 'Minion Instability':
      return arch.damageStyle === 'minion' && /Raging Spirit|Skeleton/i.test(arch.mainSkill.name);
    case 'Necromantic Aegis':
      return !isHC && arch.damageStyle === 'minion' && arch.weaponSetup.includes('shield');
    case 'Resolute Technique':
      return arch.damageStyle === 'attack' && arch.critMode === 'non_crit' && arch.primaryAttr !== 'dex' && !allocatedKeystones?.has('Precise Technique');
    case 'Precise Technique':
      return arch.damageStyle === 'attack' && arch.critMode === 'non_crit' && arch.primaryAttr === 'dex' && !allocatedKeystones?.has('Resolute Technique');
    case 'Elemental Overload':
      return arch.critMode === 'non_crit' && arch.damageStyle !== 'minion' && arch.damageStyle !== 'link_support' && arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning');
    case 'Avatar of Fire':
      return arch.elements.length === 1 && arch.elements[0] === 'fire' && arch.damageStyle !== 'minion' && arch.damageStyle !== 'link_support';
    case 'Pain Attunement':
      // CI is always Full Life (1/1), and our builds reserve Mana rather than Life.
      return false;
    case 'Eldritch Battery':
      return arch.defenseStyle === 'life' && manaReservedPct >= 65 && (arch.primaryAttr === 'int' || arch.classData.name === 'Witch' || arch.classData.name === 'Shadow' || arch.classData.name === 'Templar');
    case 'Mind Over Matter':
      return (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid') && manaReservedPct <= 50;
    case 'The Agnostic':
      return arch.defenseStyle === 'life' && manaReservedPct <= 45 && !allocatedKeystones?.has('Eternal Youth');
    case 'Eternal Youth':
      return false;
    case 'Acrobatics':
      if ((arch.options.targets?.minDodgePct ?? 0) > 0 && !isHC) return true;
      if ((arch.options.targets?.minSuppressPct ?? 0) > 0) return false;
      return arch.defenseStyle === 'life' && arch.primaryAttr === 'dex' && !isHC;
    case 'Iron Reflexes':
      if ((arch.options.targets?.minEvasion ?? 0) > 0 || (arch.options.targets?.minEvadePct ?? 0) > 0) return false;
      if ((arch.options.targets?.minArmour ?? 0) > 0 && arch.defenseStyle === 'life') return true;
      return arch.defenseStyle === 'life' && isHC && (arch.primaryAttr === 'str' || arch.classData.name === 'Duelist');
    case 'Magebane':
      return arch.defenseStyle === 'life' && isHC && arch.primaryAttr === 'dex';
    case 'Ghost Dance':
      return (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') && arch.primaryAttr !== 'str';
    case 'Ghost Reaver':
      return (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') && (arch.damageStyle === 'attack' || arch.damageStyle === 'spell') && !arch.mainSkill.types.includes('DamageOverTime') && !allocatedKeystones?.has('Wicked Ward');
    case 'Wicked Ward':
      return (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') && !allocatedKeystones?.has('Ghost Reaver');
    case 'Zealot\'s Oath':
      return arch.defenseStyle === 'es';
    case 'Divine Shield':
      return (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') && isArmourClass;
    case 'Point Blank':
      return arch.damageStyle === 'attack' && arch.statKeywords.includes('projectile');
    case 'Perfect Agony':
      return arch.damageStyle === 'dot' && arch.critMode === 'crit';
    case 'Crimson Dance':
      return arch.damageStyle === 'dot' && arch.elements.includes('physical') && isAttackSkill;
    case 'Iron Grip':
      return arch.damageStyle === 'attack' && arch.statKeywords.includes('projectile') && isStrBuild;
    case 'Iron Will':
      return isSpellSkill && isStrBuild;
    case 'The Impaler':
      return arch.damageStyle === 'attack' && arch.elements.length === 1 && arch.elements[0] === 'physical' && arch.critMode === 'non_crit' && arch.statKeywords.includes('slam');
    case 'Glancing Blows':
      if ((arch.options.targets?.minAttackBlockPct ?? 0) > 0 || (arch.options.targets?.minSpellBlockPct ?? 0) > 0) {
        return arch.weaponSetup.includes('shield') || arch.weaponSetup === 'staff' || arch.weaponSetup === 'dual_wield';
      }
      return arch.weaponSetup.includes('shield') && (arch.ascendancy.internal === 'Necromancer' || arch.ascendancy.internal === 'Guardian');
    case 'Versatile Combatant':
      if ((arch.options.targets?.minSpellBlockPct ?? 0) > 0) return arch.weaponSetup.includes('shield');
      return arch.weaponSetup.includes('shield') && arch.ascendancy.internal === 'Gladiator';
    case 'Solipsism':
      return arch.statStack === 'int' && arch.defenseStyle === 'life';
    case 'Voracious Flame':
      return arch.damageStyle === 'dot' && arch.elements.length === 1 && arch.elements[0] === 'fire';
    case 'Bitter Frost':
      return !isHC && arch.elements.length === 1 && arch.elements[0] === 'cold' && arch.damageStyle !== 'minion';
    case 'Roiling Tempest':
      return !isHC && arch.elements.length === 1 && arch.elements[0] === 'lightning' && arch.damageStyle !== 'minion';
    case 'Unwavering Stance':
      return Boolean(opts?.fromItem)
        && !opts?.isEvasionBuild
        && arch.defenseStyle === 'life'
        && arch.primaryAttr === 'str'
        && (arch.options.targets?.minEvasion ?? 0) === 0
        && (arch.options.targets?.minEvadePct ?? 0) === 0
        && (arch.options.targets?.minDodgePct ?? 0) === 0
        && !allocatedKeystones?.has('Acrobatics');
    case 'Vaal Pact':
      return Boolean(opts?.fromItem) && !isHC && arch.defenseStyle === 'life' && arch.damageStyle === 'attack';
    case 'Conduit':
    case 'Call to Arms':
      return Boolean(opts?.fromItem);
    default:
      return false;
  }
}

function isKeystoneAllowed(
  node: TreeNode,
  arch: BuildArchetype,
  manaReservedPct = 80,
  allocatedKeystones?: Set<string>,
): boolean {
  return isKeystoneNameAllowed(node.n, arch, manaReservedPct, allocatedKeystones);
}

const KEYSTONE_WEIGHT: Record<string, number> = {
  'Chaos Inoculation': 360,
  'Ancestral Bond': 180,
  Runebinder: 80,
  'Elemental Overload': 36,
  'Resolute Technique': 36,
  'Precise Technique': 36,
  'Perfect Agony': 36,
  'Point Blank': 24,
  'Avatar of Fire': 24,
  'Crimson Dance': 24,
  'Zealot\'s Oath': 20,
  'Wicked Ward': 20,
  'Ghost Reaver': 20,
  'Ghost Dance': 20,
  Acrobatics: -18,
};

function pureAttrKind(node: TreeNode): 'str' | 'dex' | 'int' | null {
  if (node.t !== 'notable' || !node.s || node.s.length === 0) return null;
  if (!node.s.every((l) => /^\+\d+ to (Strength|Dexterity|Intelligence|all Attributes|Strength and Dexterity|Strength and Intelligence|Dexterity and Intelligence)$/.test(l.trim()))) {
    return null;
  }
  const joined = node.s.join(' ');
  if (/Strength/.test(joined) && !/Dexterity|Intelligence/.test(joined)) return 'str';
  if (/Dexterity/.test(joined) && !/Strength|Intelligence/.test(joined)) return 'dex';
  if (/Intelligence/.test(joined) && !/Strength|Dexterity/.test(joined)) return 'int';
  return 'str';
}

function scoreNode(id: number, node: TreeNode, arch: BuildArchetype, manaReservedPct = 80): number {
  if (node.t === 'start' || node.t === 'ascStart' || node.t === 'mastery') return 0;
  const pureKind = pureAttrKind(node);
  if (pureKind) {
    return arch.statStack === pureKind ? 22 : -5;
  }
  let score = scoreStatsText(node.s, arch);
  if (node.t === 'notable') score += 10;
  else if (node.t === 'jewel') {
    score += arch.options.economy === 'trade' ? 34 : 20;
  } else if (node.t === 'keystone') {
    if (!isKeystoneAllowed(node, arch, manaReservedPct)) return -9999;
    let kw = KEYSTONE_WEIGHT[node.n] ?? 12;
    if (node.n === 'Acrobatics' && (arch.options.targets?.minDodgePct ?? 0) > 0) kw = 85;
    if (node.n === 'Glancing Blows' && ((arch.options.targets?.minAttackBlockPct ?? 0) > 0 || (arch.options.targets?.minSpellBlockPct ?? 0) > 0)) kw = 140;
    if (node.n === 'Versatile Combatant' && (arch.options.targets?.minSpellBlockPct ?? 0) > 0) kw = 130;
    score += kw;
  }
  // Small bonus for neutral travel nodes (never overwrite negative scores like life on CI/ES!)
  if (node.t === 'normal' && score === 0) score = 0.5;
  void id;
  return score;
}

function allocateAscendancy(
  tree: TreeData,
  arch: BuildArchetype,
  rng: Rng,
): {
  ascendancyNodes: number[];
  ascPointsUsed: number;
  extraPassivePoints: number;
  extraStartClasses: number[];
} {
  const startId = arch.ascendancy.start;
  if (!startId || !tree.nodes[startId]) {
    return { ascendancyNodes: [], ascPointsUsed: 0, extraPassivePoints: 0, extraStartClasses: [] };
  }

  const ascName = arch.ascendancy.internal;
  const maxAscPoints = tree.points.ascendancyPoints || 8;
  const allocated = new Set<number>([startId]);
  const selectedMco = new Set<number>();
  let ascPointsUsed = 0;

  while (ascPointsUsed < maxAscPoints) {
    // Gather frontier nodes in this ascendancy (ignoring mco, which are attached to mc nodes)
    const candidates: { id: number; node: TreeNode; cost: number; value: number }[] = [];
    // Multi-step lookahead via BFS within ascendancy so we value 2-point notable branches properly
    const dist = new Map<number, number>();
    const parent = new Map<number, number>();
    const q: number[] = [...allocated];
    for (const a of allocated) dist.set(a, 0);

    while (q.length > 0) {
      const cur = q.shift()!;
      const curD = dist.get(cur)!;
      for (const nxt of tree.nodes[cur]?.adj ?? []) {
        const nn = tree.nodes[nxt];
        if (!nn || nn.a !== ascName || nn.mco || dist.has(nxt)) continue;
        dist.set(nxt, curD + 1);
        parent.set(nxt, cur);
        q.push(nxt);
      }
    }

    for (const [id, d] of dist.entries()) {
      if (d === 0 || d > maxAscPoints - ascPointsUsed) continue;
      const node = tree.nodes[id];
      if (node.t !== 'notable') continue;
      let val = scoreStatsText(node.s, arch) + 25;
      if (node.mc) {
        // Evaluate best option among mco children
        const options = node.adj
          .map((oid) => ({ oid, onode: tree.nodes[oid] }))
          .filter((o) => o.onode && o.onode.mco);
        const bestOpt = options.reduce(
          (best, o) => {
            const s = scoreStatsText(o.onode.s, arch) + 25;
            return s > best.s ? { ...o, s } : best;
          },
          { oid: 0, onode: undefined as TreeNode | undefined, s: -999 },
        );
        val = Math.max(val, bestOpt.s);
      }
      if (node.gp) val += node.gp * 14;
      candidates.push({ id, node, cost: d, value: val / Math.pow(d, 0.9) });
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.value - a.value);
    const pool = candidates.slice(0, Math.min(3, candidates.length));
    const chosen = rng.weighted(pool, (c) => Math.max(1, c.value))!;

    // Trace back path from chosen.id to allocated
    const path: number[] = [];
    let cur: number | undefined = chosen.id;
    while (cur !== undefined && !allocated.has(cur)) {
      path.push(cur);
      cur = parent.get(cur);
    }
    path.reverse();
    for (const pid of path) {
      if (ascPointsUsed >= maxAscPoints) break;
      allocated.add(pid);
      ascPointsUsed++;
      const pnode = tree.nodes[pid];
      if (pnode?.mc) {
        const opts = pnode.adj
          .map((oid) => ({ oid, onode: tree.nodes[oid] }))
          .filter((o) => o.onode && o.onode.mco);
        if (opts.length > 0) {
          const pickedOpt = rng.weighted(opts, (o) => Math.max(1, scoreStatsText(o.onode.s, arch) + 20))!;
          selectedMco.add(pickedOpt.oid);
        }
      }
    }
  }

  // If points still remain (e.g. small nodes left), pick adjacent small asc nodes
  while (ascPointsUsed < maxAscPoints) {
    const frontier: number[] = [];
    for (const aid of allocated) {
      for (const nid of tree.nodes[aid]?.adj ?? []) {
        const nn = tree.nodes[nid];
        if (nn && nn.a === ascName && !nn.mco && !allocated.has(nid)) {
          frontier.push(nid);
        }
      }
    }
    if (frontier.length === 0) break;
    const pick = rng.weighted(frontier, (fid) => Math.max(1, scoreStatsText(tree.nodes[fid]?.s, arch) + 10))!;
    allocated.add(pick);
    ascPointsUsed++;
  }

  let extraPassivePoints = 0;
  const extraStartClasses: number[] = [];
  for (const id of allocated) {
    const n = tree.nodes[id];
    if (!n) continue;
    if (n.gp) extraPassivePoints += n.gp;
    if (n.n in PATH_TO_CLASS_START) extraStartClasses.push(PATH_TO_CLASS_START[n.n]);
  }

  const allAsc = [...allocated, ...selectedMco].filter((id) => id !== startId);
  return {
    ascendancyNodes: allAsc,
    ascPointsUsed,
    extraPassivePoints,
    extraStartClasses,
  };
}

export function generatePassiveTree(
  data: GameData,
  arch: BuildArchetype,
  rng: Rng,
  attrReqs: { str: number; dex: number; int: number } = { str: 0, dex: 0, int: 0 },
  manaReservedPct = 80,
): GeneratedTree {
  const tree = data.tree;
  const { ascendancyNodes, ascPointsUsed, extraPassivePoints, extraStartClasses } = allocateAscendancy(tree, arch, rng.fork('asc'));

  const banditPoints = arch.bandit === 'None' ? 24 : 23;
  const baseBudget = Math.min(tree.points.totalPoints, Math.max(1, arch.options.level - 1 + banditPoints));
  const pointsBudget = baseBudget + extraPassivePoints;

  const allocated = new Set<number>([arch.classData.start]);
  const allocatedKeystones = new Set<string>();
  const masteryEffects: Record<number, number> = {};
  const usedMasteryEffects = new Set<number>();
  let pointsUsed = 0;

  // Track live attributes so pure +30 stat nodes are only picked if requirements actually demand them
  const curAttrs = { str: arch.classData.str, dex: arch.classData.dex, int: arch.classData.int };
  const addNodeAttrs = (nid: number) => tallyNodeAttributes(tree.nodes[nid], curAttrs);
  for (const aid of ascendancyNodes) addNodeAttrs(aid);
  // Rare gear & amulets reliably supply ~60 off-attributes; only take +30 nodes late if still short
  const needStr = Math.max(0, attrReqs.str - 60);
  const needDex = Math.max(0, attrReqs.dex - 60);
  const needInt = Math.max(0, attrReqs.int - 60);

  // Extra starting points unlocked by Ascendant "Path of the ..."
  const rootSeeds = new Set<number>([arch.classData.start]);
  for (const clsId of extraStartClasses) {
    const cls = tree.classes.find((c) => c.id === clsId);
    if (cls) {
      for (const nid of tree.nodes[cls.start]?.adj ?? []) {
        const nn = tree.nodes[nid];
        if (nn && !nn.a) rootSeeds.add(nid);
      }
    }
  }

  // Precompute node base scores
  const nodeScore = new Map<number, number>();
  for (const [idStr, node] of Object.entries(tree.nodes)) {
    if (node.a || node.t === 'start' || node.t === 'ascStart' || node.t === 'mastery') continue;
    const id = Number(idStr);
    let sc = scoreNode(id, node, arch, manaReservedPct);
    if (node.t === 'jewel' && data.clusters.sockets[idStr]?.size === 2) {
      sc += arch.options.economy === 'trade' ? 22 : 12;
    }
    nodeScore.set(id, sc);
  }

  // Helper: allocate a node and optionally pick a high-value adjacent mastery
  const tryPickMasteryForNotable = (notableId: number) => {
    if (pointsUsed >= pointsBudget) return;
    const n = tree.nodes[notableId];
    if (!n) return;
    for (const adjId of n.adj) {
      if (pointsUsed >= pointsBudget) break;
      const m = tree.nodes[adjId];
      if (!m || m.t !== 'mastery' || !m.me || allocated.has(adjId)) continue;
      if (!isMasteryAllowed(m.n, arch)) continue;
      // Score each unused mastery effect
      let bestEffect: { e: number; s: string[]; score: number } | null = null;
      for (const eff of m.me) {
        if (usedMasteryEffects.has(eff.e)) continue;
        const effText = eff.s.join(' ').toLowerCase();
        if (/at least 6 life masteries|no life modifiers on equipped body/.test(effText)) continue;
        const sc = scoreStatsText(eff.s, arch);
        if (!bestEffect || sc > bestEffect.score) {
          bestEffect = { ...eff, score: sc };
        }
      }
      if (bestEffect && bestEffect.score >= 16) {
        allocated.add(adjId);
        masteryEffects[adjId] = bestEffect.e;
        usedMasteryEffects.add(bestEffect.e);
        pointsUsed++;
      }
    }
  };

  const clusterReserve = arch.options.economy === 'trade' ? 13 : 7;
  const hasOuterSocketAllocated = () =>
    [...allocated].some((id) => data.clusters.sockets[String(id)]?.size === 2);

  // Helper: iteratively expand toward the best efficiency notable / keystone / jewel socket
  const expandNotableBfs = (stopForCluster: boolean) => {
    while (pointsUsed < pointsBudget) {
      const waitForCI = arch.defenseStyle === 'es' && arch.options.leagueMode === 'hardcore' && !allocatedKeystones.has('Chaos Inoculation');
      if (stopForCluster && !waitForCI && hasOuterSocketAllocated() && pointsBudget - pointsUsed <= clusterReserve) break;
      const remaining = pointsBudget - pointsUsed;
      const dist = new Map<number, number>();
      const prev = new Map<number, number>();
      const queue: number[] = [];
      for (const a of allocated) {
        dist.set(a, 0);
        queue.push(a);
      }
      for (const seed of rootSeeds) {
        if (!allocated.has(seed) && !dist.has(seed)) {
          dist.set(seed, 1);
          queue.push(seed);
        }
      }

      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        const d = dist.get(cur)!;
        if (d >= remaining || d >= 18) continue;
        const cnode = tree.nodes[cur];
        if (!cnode || cnode.t === 'mastery') continue;
        for (const nxt of cnode.adj) {
          const nn = tree.nodes[nxt];
          if (!nn || nn.a || nn.t === 'start' || nn.t === 'mastery') continue;
          if (nn.t === 'keystone' && !isKeystoneAllowed(nn, arch, manaReservedPct, allocatedKeystones)) continue;
          if ((nodeScore.get(nxt) ?? 0) <= -80) continue;
          if (!dist.has(nxt)) {
            dist.set(nxt, d + 1);
            prev.set(nxt, cur);
            queue.push(nxt);
          }
        }
      }

      const targets: { id: number; d: number; effScore: number }[] = [];
      for (const [id, d] of dist.entries()) {
        if (d === 0 || d > remaining) continue;
        const nn = tree.nodes[id];
        if (!nn) continue;
        if (nn.t !== 'notable' && nn.t !== 'keystone' && nn.t !== 'jewel') continue;
        let base = nodeScore.get(id) ?? 0;
        const pureKind = pureAttrKind(nn);
        if (pureKind && !arch.statStack && pointsUsed >= Math.floor(pointsBudget * 0.8)) {
          const missing =
            (pureKind === 'str' && curAttrs.str < needStr) ||
            (pureKind === 'dex' && curAttrs.dex < needDex) ||
            (pureKind === 'int' && curAttrs.int < needInt);
          if (missing && d === 1) base = 24;
        }
        if (base <= 2) continue;

        let pathBonus = 0;
        let p: number | undefined = prev.get(id);
        while (p !== undefined && !allocated.has(p)) {
          pathBonus += Math.max(0, (nodeScore.get(p) ?? 0) * 0.25);
          p = prev.get(p);
        }
        const effScore = (base + pathBonus) / Math.pow(d, 1.32);
        targets.push({ id, d, effScore });
      }

      if (targets.length === 0) break;
      targets.sort((a, b) => b.effScore - a.effScore);
      const topPool = targets.slice(0, Math.min(6, targets.length));
      const chosen = rng.weighted(topPool, (t) => Math.pow(Math.max(0.1, t.effScore), 1.6))!;

      const path: number[] = [];
      let cur: number | undefined = chosen.id;
      while (cur !== undefined && !allocated.has(cur)) {
        path.push(cur);
        cur = prev.get(cur);
      }
      path.reverse();

      for (const pid of path) {
        if (pointsUsed >= pointsBudget) break;
        if (!allocated.has(pid)) {
          const pn = tree.nodes[pid];
          if (pn?.t === 'keystone') allocatedKeystones.add(pn.n);
          allocated.add(pid);
          addNodeAttrs(pid);
          pointsUsed++;
          if (pn?.t === 'notable') {
            tryPickMasteryForNotable(pid);
          }
        }
      }
    }
  };

  expandNotableBfs(true);

  const clusterRes = allocateClusterJewelsForTree(
    data,
    arch,
    rng.fork('clusters'),
    allocated,
    pointsUsed,
    pointsBudget,
    (s) => scoreStatsText(s, arch),
  );
  for (const nid of clusterRes.allocatedNodeIds) {
    allocated.add(nid);
    tallyNodeAttributes(clusterRes.clusterNodes[nid], curAttrs);
  }
  pointsUsed += clusterRes.pointsSpent;

  if (pointsUsed < pointsBudget) {
    expandNotableBfs(false);
  }

  // Spend any leftover points on best adjacent travel / jewel / notable nodes
  while (pointsUsed < pointsBudget) {
    const frontier: number[] = [];
    for (const a of allocated) {
      const an = tree.nodes[a];
      if (!an || an.t === 'mastery') continue;
      for (const nid of an.adj) {
        const nn = tree.nodes[nid];
        if (!nn || nn.a || nn.t === 'start' || nn.t === 'mastery' || allocated.has(nid)) continue;
        if (nn.t === 'keystone' && !isKeystoneAllowed(nn, arch, manaReservedPct, allocatedKeystones)) continue;
        frontier.push(nid);
      }
    }
    if (frontier.length === 0) break;
    const safeFrontier = frontier.filter((id) => (nodeScore.get(id) ?? 0) > -80);
    const pool = safeFrontier.length > 0 ? safeFrontier : frontier;
    const pick = rng.weighted(pool, (id) => {
      const sc = nodeScore.get(id) ?? 1;
      if (sc < 0) return 0.05;
      return Math.max(1, sc + 5);
    })!;
    const pickNode = tree.nodes[pick];
    if (pickNode?.t === 'keystone') allocatedKeystones.add(pickNode.n);
    allocated.add(pick);
    addNodeAttrs(pick);
    pointsUsed++;
  }

  const mainNodes = [...allocated].filter((id) => id !== arch.classData.start);
  const allNodes = [...new Set([...mainNodes, ...ascendancyNodes])].sort((a, b) => a - b);

  // Tally summary stats
  const summaryAttrs = {
    str: arch.classData.str,
    dex: arch.classData.dex,
    int: arch.classData.int,
  };
  let lifePct = 0;
  let esPct = 0;
  const keystones: string[] = [];
  const notables: string[] = [];
  const masteries: GeneratedTree['summary']['masteries'] = [];
  const jewelSockets: number[] = [];

  for (const id of allNodes) {
    const n = tree.nodes[id] ?? clusterRes.clusterNodes[id];
    if (!n) continue;
    tallyNodeAttributes(n, summaryAttrs);
    if (n.t === 'keystone') keystones.push(n.n);
    if (n.t === 'notable' && !n.a) notables.push(n.n);
    if (n.t === 'jewel') jewelSockets.push(id);
    if (n.t === 'mastery' && masteryEffects[id]) {
      const eff = n.me?.find((m) => m.e === masteryEffects[id]);
      if (eff) masteries.push({ nodeId: id, name: n.n, effectId: eff.e, text: eff.s.join(' / ') });
    }
    for (const s of n.s ?? []) {
      const mLife = /(\d+)% increased maximum Life/.exec(s);
      if (mLife) lifePct += Number(mLife[1]);
      const mEs = /(\d+)% increased maximum Energy Shield/.exec(s);
      if (mEs) esPct += Number(mEs[1]);
    }
  }

  const url = encodeTreeUrl(
    tree.urlVersion,
    arch.classData.id,
    arch.ascendancy.id,
    allNodes,
    masteryEffects,
    tree,
  );

  return {
    classId: arch.classData.id,
    ascendClassId: arch.ascendancy.id,
    nodes: allNodes,
    ascendancyNodes,
    masteryEffects,
    jewelSockets,
    ...(Object.keys(clusterRes.clusterNodes).length > 0 ? { clusterNodes: clusterRes.clusterNodes } : {}),
    ...(clusterRes.clusterJewels.length > 0 ? { clusterJewels: clusterRes.clusterJewels } : {}),
    pointsUsed,
    pointsBudget,
    ascPointsUsed,
    attributes: summaryAttrs,
    summary: { lifePct, esPct, keystones, notables, masteries },
    url,
  };
}

function getNodeAttrDelta(n: TreeNode): { str: number; dex: number; int: number } {
  let str = n.gs ?? 0;
  let dex = n.gd ?? 0;
  let int = n.gi ?? 0;
  for (const s of n.s ?? []) {
    const ms = /\+(\d+) to Strength(?: and (\w+))?/i.exec(s);
    if (ms) {
      const v = Number(ms[1]);
      str += v;
      if (ms[2]?.toLowerCase() === 'dexterity') dex += v;
      if (ms[2]?.toLowerCase() === 'intelligence') int += v;
    }
    const md = /\+(\d+) to Dexterity(?: and (\w+))?/i.exec(s);
    if (md) {
      const v = Number(md[1]);
      dex += v;
      if (md[2]?.toLowerCase() === 'intelligence') int += v;
    }
    const mi = /\+(\d+) to Intelligence/i.exec(s);
    if (mi) int += Number(mi[1]);
    const mall = /\+(\d+) to all Attributes/i.exec(s);
    if (mall) {
      const v = Number(mall[1]);
      str += v; dex += v; int += v;
    }
  }
  return { str, dex, int };
}

/**
 * Fallback after gear-first attribute satisfaction: swaps low-priority leaf normal nodes
 * for adjacent/reachable attribute nodes if any gem/equipment requirement is still short.
 */
export function patchTreeAttributes(
  data: GameData,
  arch: BuildArchetype,
  genTree: GeneratedTree,
  required: { str: number; dex: number; int: number },
  gearAttrs: { str: number; dex: number; int: number },
): { str: number; dex: number; int: number } {
  const added = { str: 0, dex: 0, int: 0 };
  if (gearAttrs.str >= required.str && gearAttrs.dex >= required.dex && gearAttrs.int >= required.int) {
    return added;
  }
  const tree = data.tree;
  const isHC = arch.options.leagueMode === 'hardcore';
  const mainSet = new Set<number>([arch.classData.start]);
  for (const id of genTree.nodes) {
    const n = tree.nodes[id];
    if (n && !n.a) mainSet.add(id);
  }
  const ascSet = new Set(genTree.ascendancyNodes);

  for (let step = 0; step < 12; step++) {
    const cur = {
      str: gearAttrs.str + added.str,
      dex: gearAttrs.dex + added.dex,
      int: gearAttrs.int + added.int,
    };
    const needKey = (['str', 'dex', 'int'] as const)
      .map((k) => ({ k, miss: required[k] - cur[k] }))
      .filter((x) => x.miss > 0)
      .sort((a, b) => b.miss - a.miss)[0]?.k;
    if (!needKey) break;

    // Pick highest-value nearby unallocated path (1..3 hops) ending on a node providing the missing attribute
    let bestPath: number[] | null = null;
    let bestScore = -1;
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const q: number[] = [];
    for (const a of mainSet) {
      const an = tree.nodes[a];
      if (!an || an.t === 'mastery') continue;
      dist.set(a, 0);
      q.push(a);
    }
    let qi = 0;
    while (qi < q.length) {
      const u = q[qi++];
      const du = dist.get(u)!;
      if (du >= 3) continue;
      for (const nid of tree.nodes[u]?.adj ?? []) {
        if (mainSet.has(nid) || dist.has(nid)) continue;
        const nn = tree.nodes[nid];
        if (!nn || nn.a || nn.t === 'start' || nn.t === 'mastery' || nn.t === 'keystone') continue;
        dist.set(nid, du + 1);
        prev.set(nid, u);
        q.push(nid);

        const delta = getNodeAttrDelta(nn);
        if (delta[needKey] > 0) {
          const hop = du + 1;
          const sc = (delta[needKey] * 2 + (nn.t === 'notable' ? 10 : 0)) / hop;
          if (sc > bestScore) {
            const path: number[] = [];
            let trace: number | undefined = nid;
            while (trace !== undefined && !mainSet.has(trace)) {
              path.push(trace);
              trace = prev.get(trace);
            }
            path.reverse();
            bestScore = sc;
            bestPath = path;
          }
        }
      }
    }
    if (!bestPath || bestPath.length === 0) break;

    // Find safe normal leaf nodes (degree 1 in mainSet, keeping ele res & other attrs safe) to swap out
    const bridgeParent = tree.nodes[bestPath[0]]?.adj ?? [];
    const dropIds: number[] = [];
    const simSet = new Set(mainSet);
    const simCur = { ...cur };
    for (let k = 0; k < bestPath.length; k++) {
      let pickedDrop: number | null = null;
      for (const id of simSet) {
        if (id === arch.classData.start || ascSet.has(id)) continue;
        const n = tree.nodes[id];
        if (!n || n.t !== 'normal') continue;
        const deg = n.adj.filter((adjId) => simSet.has(adjId)).length;
        if (deg !== 1) continue;
        if (bridgeParent.includes(id) && n.adj.filter((adjId) => simSet.has(adjId)).length <= 1) {
          // Ensure we don't delete the sole allocated neighbor anchoring bestPath[0]
          const anchorsElsewhere = bridgeParent.some((bid) => bid !== id && simSet.has(bid));
          if (!anchorsElsewhere) continue;
        }
        const txt = (n.s ?? []).join(' ').toLowerCase();
        if (/elemental resistances|(?:fire|cold|lightning) resistance/.test(txt) || (isHC && /resistance/.test(txt))) continue;
        const ld = getNodeAttrDelta(n);
        if (ld[needKey] > 0) continue;
        if (ld.str > 0 && simCur.str - ld.str < required.str && needKey !== 'str') continue;
        if (ld.dex > 0 && simCur.dex - ld.dex < required.dex && needKey !== 'dex') continue;
        if (ld.int > 0 && simCur.int - ld.int < required.int && needKey !== 'int') continue;
        pickedDrop = id;
        simCur.str -= ld.str;
        simCur.dex -= ld.dex;
        simCur.int -= ld.int;
        break;
      }
      if (pickedDrop === null) break;
      simSet.delete(pickedDrop);
      dropIds.push(pickedDrop);
    }
    if (dropIds.length < bestPath.length) break;

    for (const did of dropIds) {
      const dd = getNodeAttrDelta(tree.nodes[did]);
      mainSet.delete(did);
      added.str -= dd.str;
      added.dex -= dd.dex;
      added.int -= dd.int;
    }
    for (const aid of bestPath) {
      const ad = getNodeAttrDelta(tree.nodes[aid]);
      mainSet.add(aid);
      added.str += ad.str;
      added.dex += ad.dex;
      added.int += ad.int;
    }
  }

  if (added.str !== 0 || added.dex !== 0 || added.int !== 0) {
    const mainNodes = [...mainSet].filter((id) => id !== arch.classData.start);
    const allNodes = [...new Set([...mainNodes, ...genTree.ascendancyNodes])].sort((a, b) => a - b);
    genTree.nodes = allNodes;
    genTree.attributes.str += added.str;
    genTree.attributes.dex += added.dex;
    genTree.attributes.int += added.int;
    genTree.summary.notables = allNodes
      .map((id) => tree.nodes[id] ?? genTree.clusterNodes?.[id])
      .filter((n) => n && n.t === 'notable' && !n.a)
      .map((n) => n.n);
    genTree.url = encodeTreeUrl(
      tree.urlVersion,
      arch.classData.id,
      arch.ascendancy.id,
      allNodes,
      genTree.masteryEffects,
      tree,
    );
  }
  return added;
}

export function encodeTreeUrl(
  urlVersion: string,
  classId: number,
  ascendClassId: number,
  nodeIds: number[],
  masteryEffects: Record<number, number>,
  tree: TreeData,
): string {
  const bytes: number[] = [0, 0, 0, 6, classId, ascendClassId, 0];
  const clusterBytes: number[] = [];
  const masteryBytes: number[] = [];
  let nodeCount = 0;
  let clusterCount = 0;
  let masteryCount = 0;

  const sorted = [...nodeIds].sort((a, b) => a - b);
  for (const id of sorted) {
    if (id >= 65536 && clusterCount < 255) {
      const cid = id - 65536;
      clusterBytes.push(Math.floor(cid / 256), cid % 256);
      clusterCount++;
      continue;
    }
    const n = tree.nodes[id];
    if (!n || n.t === 'start' || n.t === 'ascStart') continue;
    if (id < 65536 && nodeCount < 255) {
      bytes.push(Math.floor(id / 256), id % 256);
      nodeCount++;
      if (masteryEffects[id]) {
        const eff = masteryEffects[id];
        masteryBytes.push(Math.floor(eff / 256), eff % 256, Math.floor(id / 256), id % 256);
        masteryCount++;
      }
    }
  }
  bytes[6] = nodeCount;
  bytes.push(clusterCount, ...clusterBytes);
  bytes.push(masteryCount, ...masteryBytes);

  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
  return `https://www.pathofexile.com/passive-skill-tree/${urlVersion}/${b64}`;
}
