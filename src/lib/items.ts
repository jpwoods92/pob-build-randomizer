import type { BaseData, GameData, ModData, UniqueData } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import { extractKeystonesFromLines, isKeystoneNameAllowed, type GeneratedTree } from './tree.ts';
import type { GeneratedSkills } from './skills.ts';
import type { Rng } from './rng.ts';

export type ItemSlotName =
  | 'Weapon 1'
  | 'Weapon 2'
  | 'Helmet'
  | 'Body Armour'
  | 'Gloves'
  | 'Boots'
  | 'Amulet'
  | 'Ring 1'
  | 'Ring 2'
  | 'Belt'
  | 'Flask 1'
  | 'Flask 2'
  | 'Flask 3'
  | 'Flask 4'
  | 'Flask 5';

export interface RolledAffix {
  mod: ModData;
  range: number;
  resolvedLines: string[];
}

export interface GeneratedItem {
  id: number;
  slot: string; // ItemSlotName or `Jewel ${nodeId}`
  jewelNodeId?: number;
  rarity: 'UNIQUE' | 'RARE' | 'MAGIC';
  name: string;
  baseName: string;
  base: BaseData;
  itemLevel: number;
  quality?: number;
  sockets?: string;
  variant?: number;
  implicits: string[];
  explicits: string[];
  prefixes: RolledAffix[];
  suffixes: RolledAffix[];
  craftedMod?: string;
  rawText: string;
}

export interface GeneratedGear {
  items: GeneratedItem[];
  slotMap: Record<string, number>;
  jewelMap: Record<number, number>;
  resists: { fire: number; cold: number; lightning: number; chaos: number };
  attributes: { str: number; dex: number; int: number };
  requiredAttributes: { str: number; dex: number; int: number };
}

const RARE_FIRST = [
  'Agony', 'Apocalypse', 'Armageddon', 'Bane', 'Behemoth', 'Blight', 'Blood',
  'Bramble', 'Brood', 'Carrion', 'Cataclysm', 'Chimeric', 'Corruption', 'Damnation',
  'Demon', 'Dire', 'Doom', 'Dragon', 'Dread', 'Dusk', 'Empyrean', 'Entropy',
  'Fate', 'Foe', 'Gale', 'Ghoul', 'Gloom', 'Glyph', 'Golem', 'Grim', 'Hate',
  'Havoc', 'Honour', 'Horror', 'Hypnotic', 'Kraken', 'Loath', 'Maelstrom',
  'Mind', 'Miracle', 'Morbid', 'Mortal', 'Oblivion', 'Onslaught', 'Pain',
  'Pandemonium', 'Phoenix', 'Plague', 'Rage', 'Rapture', 'Rift', 'Rune',
  'Sorrow', 'Soul', 'Spirit', 'Storm', 'Tempest', 'Torment', 'Vengeance',
  'Viper', 'Vortex', 'Woe', 'Wrath',
];

const RARE_SECOND = [
  'Aegis', 'Anchor', 'Bane', 'Barb', 'Bastion', 'Bite', 'Blaze', 'Branch',
  'Brand', 'Breaker', 'Buckle', 'Call', 'Carapace', 'Chant', 'Clasp', 'Claw',
  'Coil', 'Crest', 'Crown', 'Curse', 'Edge', 'Embrace', 'Eye', 'Fang', 'Fist',
  'Flame', 'Flesh', 'Gaze', 'Grasp', 'Guard', 'Gyre', 'Heart', 'Hide', 'Hold',
  'Horn', 'Jack', 'Knuckle', 'Lash', 'Loop', 'Mantle', 'Mark', 'Nail', 'Noose',
  'Pact', 'Peak', 'Pelt', 'Scalpel', 'Scar', 'Scream', 'Shackle', 'Shell',
  'Shield', 'Shroud', 'Sight', 'Skewer', 'Snare', 'Song', 'Spark', 'Spike',
  'Spiral', 'Spire', 'Spur', 'Star', 'Sting', 'Suit', 'Talisman', 'Tether',
  'Thirst', 'Thorn', 'Touch', 'Track', 'Tread', 'Turn', 'Twirl', 'Vise',
  'Ward', 'Watch', 'Weaver', 'Whisper', 'Wind', 'Wing', 'Whorl',
];

// Extremely rare / boss-exclusive / chase uniques excluded in SSF
const CHASE_OR_BOSS_UNIQUE = /Mageblood|Headhunter|Ashes of the Stars|Crystallised Omniscience|Original Sin|Nimis|Progenesis|Watcher's Eye|Forbidden Flame|Forbidden Flesh|Aegis Aurora|Squire|Defiance of Destiny|Melding of the Flesh|Bottled Faith|Dying Sun|Oriath's End|Voices|Megalomaniac|Emperor's|Badge of the Brotherhood|Replica |Foulborn /i;

// Uniques with big downsides avoided in Hardcore
const HC_RISKY_UNIQUE = /Abyssus|Echoes of Creation|Veil of the Night|Scold's Bridle|Doedre's|Maligaro's Lens|Annihilation's Approach|Coward's Legacy|The Covenant|Shimmeron|Soul Mantle|Tanu Ahi/i;

export function applyRange(line: string, range: number): string {
  // Replace (a-b) numeric ranges with rolled integers (or 1-decimal floats)
  return line.replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, (_, aStr: string, bStr: string) => {
    const a = Number(aStr);
    const b = Number(bStr);
    const isFloat = aStr.includes('.') || bStr.includes('.');
    const val = a + (b - a) * range;
    return isFloat ? val.toFixed(1) : String(Math.round(val));
  });
}

function getModWeightForTags(mod: ModData, itemTags: Set<string>): number {
  for (let i = 0; i < mod.wk.length; i++) {
    const key = mod.wk[i];
    if (key === 'default' || itemTags.has(key)) {
      return mod.wv[i] ?? 0;
    }
  }
  return 0;
}

function bestEleTarget(maxRes: { fire: number; cold: number; lightning: number }): 'fire' | 'cold' | 'lightning' {
  if (maxRes.fire >= maxRes.cold && maxRes.fire >= maxRes.lightning) return 'fire';
  if (maxRes.cold >= maxRes.lightning) return 'cold';
  return 'lightning';
}

function capWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreModForArchetype(
  mod: ModData,
  arch: BuildArchetype,
  needs: { fire: number; cold: number; lightning: number; chaos: number; str: number; dex: number; int: number; suppress: number },
  isWeapon: boolean,
  hasCI: boolean,
  maxRes: { fire: number; cold: number; lightning: number; chaos: number },
  isEvasionBuild: boolean,
): number {
  const txt = mod.lines.join(' ').toLowerCase();
  if (hasCI && /chaos resistance/.test(txt)) return 0;
  if ((hasCI || arch.defenseStyle === 'es') && /\bmaximum life\b|life regeneration|regenerate .* life|life leech|life gained|life on kill|life on hit|recouped as life/.test(txt)) {
    return 0;
  }
  const isHC = arch.options.leagueMode === 'hardcore';
  const targets = arch.options.targets;
  const wantHpTarget = (targets?.minHp ?? 0) > 0;
  const wantPhysTarget = (targets?.minPhysMaxHit ?? 0) > 0 || (targets?.minArmour ?? 0) > 0;
  const wantEleTarget = (targets?.minEleMaxHit ?? 0) > 0 || (targets?.minMaxFireRes ?? 0) > 75;
  const wantEvaTarget = (targets?.minEvasion ?? 0) > 0 || (targets?.minEvadePct ?? 0) > 0;
  const wantCritTarget = (targets?.minCritChancePct ?? 0) > 0;
  const dpsBoost = (isHC ? 1.0 : 2.3) * ((targets?.minDps ?? 0) > 0 ? 1.8 : 1);
  const tags = new Set(mod.tags ?? []);
  let w = 1;

  // Penalize very low tiers at endgame
  const tierFactor = mod.lvl >= 68 ? 4.5 : mod.lvl >= 50 ? 2.6 : mod.lvl >= 30 ? 1.4 : 0.7;
  w *= tierFactor;

  if (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid') {
    if (/to maximum life/.test(txt)) w *= (isHC ? 26 : 10) * (wantHpTarget ? 2.2 : 1);
    if (/regenerate .* life/.test(txt)) w *= isHC ? 5 : 1.2;
  } else if (/to maximum life/.test(txt)) {
    w *= 0.05; // CI/ES build doesn't want flat life
  }

  if (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') {
    if (/energy shield/.test(txt)) w *= (isHC ? 18 : 8) * (wantHpTarget ? 2.0 : 1);
  }
  if (wantEvaTarget && /evasion rating/.test(txt)) w *= 14;
  if ((targets?.minArmour ?? 0) > 0 && /armour/.test(txt)) w *= 14;
  if (wantCritTarget && /critical strike chance/.test(txt)) w *= 14;
  if ((targets?.minAttackBlockPct ?? 0) > 0 && /chance to block(?! spell)|chance to block attack/.test(txt)) w *= 90;
  if ((targets?.minSpellBlockPct ?? 0) > 0 && /chance to block spell/.test(txt)) w *= 140;

  if (/suppress spell damage/.test(txt)) {
    w *= needs.suppress > 0 ? (isEvasionBuild ? (isHC ? 75 : 18) : (isHC ? 28 : 8)) : 0.25;
  }
  if (/additional physical damage reduction/.test(txt)) w *= (isHC ? 28 : 4) * (wantPhysTarget ? 2.8 : 1);
  if (/to (?:all )?maximum .* resistance/.test(txt)) w *= (isHC ? 34 : 5) * (wantEleTarget ? 2.8 : 1);
  const mTaken = /taken as (fire|cold|lightning|chaos) damage/.exec(txt);
  if (mTaken) {
    const dst = mTaken[1] as 'fire' | 'cold' | 'lightning' | 'chaos';
    if (dst === 'chaos') {
      w *= hasCI ? (isHC ? 45 : 10) : 0.05;
    } else {
      const excess = Math.max(0, maxRes[dst] - 75);
      w *= (isHC ? 26 + excess * 4 : 4) * (wantPhysTarget ? 2.6 : 1);
    }
  }
  if (/movement speed/.test(txt)) w *= 24;

  // Resistances weighted dynamically by current deficit (deprioritize already-capped elements)
  if (/fire resistance/.test(txt) && !/all elemental/.test(txt)) {
    w *= needs.fire > 0 ? (isHC ? 36 : 20) + needs.fire * 0.6 : 0.2;
  }
  if (/cold resistance/.test(txt) && !/all elemental/.test(txt)) {
    w *= needs.cold > 0 ? (isHC ? 36 : 20) + needs.cold * 0.6 : 0.2;
  }
  if (/lightning resistance/.test(txt) && !/all elemental/.test(txt)) {
    w *= needs.lightning > 0 ? (isHC ? 36 : 20) + needs.lightning * 0.6 : 0.2;
  }
  if (/all elemental resistances/.test(txt)) {
    const anyEleNeed = needs.fire > 0 || needs.cold > 0 || needs.lightning > 0;
    w *= anyEleNeed ? (isHC ? 38 : 22) : 0.3;
  }
  if (/chaos resistance/.test(txt)) {
    w *= needs.chaos > 0 ? (isHC ? 55 + needs.chaos * 0.8 : 0.4) : 0.2;
  }

  // Attributes weighted dynamically by gem/gear deficit (deprioritize once met)
  if (/to strength/.test(txt) && !/all attributes/.test(txt)) {
    w *= needs.str > 0 ? 28 + Math.min(40, needs.str * 0.5) : 0.4;
  }
  if (/to dexterity/.test(txt) && !/all attributes/.test(txt)) {
    w *= needs.dex > 0 ? 28 + Math.min(40, needs.dex * 0.5) : 0.4;
  }
  if (/to intelligence/.test(txt) && !/all attributes/.test(txt)) {
    w *= needs.int > 0 ? 28 + Math.min(40, needs.int * 0.5) : 0.4;
  }
  if (/to all attributes/.test(txt)) {
    w *= (needs.str > 0 || needs.dex > 0 || needs.int > 0) ? 32 : 0.5;
  }

  // Weapon, jewel & jewelry offensive mods
  if (isWeapon) {
    if (arch.damageStyle === 'minion') {
      const isMinionAttackTrigger = arch.mainSkill.types.includes('Attack');
      if (/to level of all minion skill gems/i.test(txt)) {
        w *= 65 * dpsBoost;
      } else if (/to level of all spell skill gems/i.test(txt)) {
        w *= arch.mainSkill.types.includes('Spell') ? 38 * dpsBoost : 0.05;
      } else if (/to level of all (fire|cold|lightning|chaos|physical) spell skill gems/i.test(txt)) {
        const gemElMatch = /to level of all (fire|cold|lightning|chaos|physical) spell skill gems/i.exec(txt);
        const gemEl = gemElMatch?.[1] as BuildArchetype['elements'][number] | undefined;
        w *= gemEl && arch.elements.includes(gemEl) ? 38 * dpsBoost : 0.05;
      } else if (/minion/.test(txt)) {
        w *= 45 * dpsBoost;
      } else if (/adds .* damage to spells|adds .* damage to attacks/.test(txt)) {
        w *= isMinionAttackTrigger && /to attacks/.test(txt) ? 6 * dpsBoost : 0.005;
      } else if (/adds \d+ to \d+ (fire|cold|lightning|chaos|physical) damage/.test(txt)) {
        w *= isMinionAttackTrigger ? 6 * dpsBoost : 0.005;
      } else if (/spell damage|(?:fire|cold|lightning|chaos|elemental) damage/.test(txt)) {
        w *= 0.02;
      } else if (/physical damage|attack speed|accuracy rating/.test(txt)) {
        w *= isMinionAttackTrigger ? 6 * dpsBoost : 0.02;
      } else if (/cast speed/.test(txt)) {
        w *= 1.5;
      }
      if (arch.critMode === 'crit') {
        if (/minion.*critical strike/.test(txt)) w *= 14 * dpsBoost;
        else if (/critical strike/.test(txt)) w *= 0.05;
      } else if (/critical strike/.test(txt)) {
        w *= 0.05;
      }
    } else if (arch.damageStyle === 'attack') {
      if (arch.elements.includes('physical') && /physical damage|attack speed/.test(txt)) w *= 14 * dpsBoost;
      if (arch.elements.includes('fire') && /fire damage to attacks|elemental damage with attacks|attack speed/.test(txt)) w *= 12 * dpsBoost;
      if (arch.elements.includes('cold') && /cold damage to attacks|elemental damage with attacks|attack speed/.test(txt)) w *= 12 * dpsBoost;
      if (arch.elements.includes('lightning') && /lightning damage to attacks|elemental damage with attacks|attack speed/.test(txt)) w *= 12 * dpsBoost;
      if (arch.elements.includes('chaos') && /chaos damage|attack speed|damage over time/.test(txt)) w *= 10 * dpsBoost;
      if (/spell damage|to level of all .* spell/.test(txt)) w *= 0.01;
      if (arch.critMode === 'crit' && /critical strike/.test(txt)) w *= 9 * dpsBoost;
      if (arch.critMode !== 'crit' && /critical strike/.test(txt)) w *= 0.05;
    } else {
      if (/spell damage|cast speed|to level of all/.test(txt)) w *= 14 * dpsBoost;
      if (arch.damageStyle === 'dot' && /damage over time multiplier/.test(txt)) w *= 18 * dpsBoost;
      if (arch.elements.includes('fire') && /fire damage|fire skill/.test(txt)) w *= 10 * dpsBoost;
      if (arch.elements.includes('cold') && /cold damage|cold skill/.test(txt)) w *= 10 * dpsBoost;
      if (arch.elements.includes('lightning') && /lightning damage|lightning skill/.test(txt)) w *= 10 * dpsBoost;
      if (arch.elements.includes('chaos') && /chaos damage|chaos skill/.test(txt)) w *= 10 * dpsBoost;
      if (/physical damage|adds .* to attacks/.test(txt) && !tags.has('caster')) w *= 0.01;
      if (arch.critMode === 'crit' && /critical strike/.test(txt)) w *= 9 * dpsBoost;
      if (arch.critMode !== 'crit' && /critical strike/.test(txt)) w *= 0.05;
    }
  } else {
    // Reject off-weapon / off-setup jewel mods cleanly
    const weaponHits: [string, boolean][] = [
      ['axe', /\bwith axes\b/.test(txt)],
      ['sword', /\bwith swords\b/.test(txt)],
      ['mace', /\bwith maces|\bsceptres\b/.test(txt)],
      ['claw', /\bwith claws\b/.test(txt)],
      ['dagger', /\bwith daggers\b/.test(txt)],
      ['wand', /\bwith wands\b/.test(txt)],
      ['staff', /\bwith staves\b/.test(txt)],
      ['bow', /\bwith bows\b/.test(txt)],
    ];
    for (const [wc, matched] of weaponHits) {
      if (matched) {
        const ok = arch.countsAsAllOneHandMelee
          ? ['sword', 'axe', 'mace', 'claw', 'dagger'].includes(wc)
          : wc === arch.weaponClass;
        if (!ok || (arch.damageStyle !== 'attack' && !['wand', 'staff', 'dagger', 'mace'].includes(wc))) {
          return 0;
        }
      }
    }
    if (/while dual wielding/.test(txt) && arch.weaponSetup !== 'dual_wield') return 0;
    if (/while holding a shield/.test(txt) && !arch.weaponSetup.includes('shield')) return 0;
    if (/two handed/.test(txt) && arch.weaponSetup !== 'two_hand' && arch.weaponSetup !== 'staff') return 0;
    if (/totem/.test(txt) && arch.damageStyle !== 'totem') return 0;
    if (/minion/.test(txt) && arch.damageStyle !== 'minion') return 0;
    if (/trap/.test(txt) && arch.trapOrMine !== 'trap') return 0;
    if (/mine/.test(txt) && arch.trapOrMine !== 'mine') return 0;

    if (arch.damageStyle === 'minion') {
      if (/to level of all minion skill gems/i.test(txt)) w *= 55 * dpsBoost;
      else if (/to level of all skill gems/i.test(txt)) w *= 42 * dpsBoost;
      else if (/minion/.test(txt)) w *= 28 * dpsBoost;
      else if (/adds .* damage to spells|adds .* damage to attacks|spell damage/.test(txt)) w *= 0.02;
      if (arch.critMode === 'crit' && /minion.*critical strike/.test(txt)) w *= 10 * dpsBoost;
      else if (/critical strike/.test(txt) && !/minion/.test(txt)) w *= 0.05;
    } else {
      if (arch.damageStyle === 'attack' && /elemental damage with attacks|adds .* to attacks|attack speed/.test(txt)) w *= 6 * dpsBoost;
      if (arch.damageStyle === 'spell' && /spell damage|cast speed|to level of all/.test(txt)) w *= 7 * dpsBoost;
      if (arch.damageStyle === 'dot' && /damage over time multiplier/.test(txt)) w *= 12 * dpsBoost;
      if (arch.critMode === 'crit' && /critical strike multiplier|critical strike chance/.test(txt)) w *= 7 * dpsBoost;
      if (arch.critMode !== 'crit' && /critical strike/.test(txt)) w *= 0.05;
    }
  }

  // Filter out junk mods like light radius / stun recovery / thorns
  if (/light radius|stun and block recovery|reflects \d+ physical|mana on kill|life on kill/.test(txt)) {
    w *= 0.05;
  }

  return w;
}

const ARMOUR_SLOTS = new Set(['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield']);
type ArmourSubType =
  | 'Armour'
  | 'Evasion'
  | 'Energy Shield'
  | 'Armour/Evasion'
  | 'Armour/Energy Shield'
  | 'Evasion/Energy Shield';

function resolveTargetArmourSubType(
  arch: BuildArchetype,
  tree: GeneratedTree,
  skills: GeneratedSkills,
  rng: Rng,
): ArmourSubType {
  const activeGems = new Set<string>();
  for (const grp of skills.groups) {
    for (const gi of grp.gems) activeGems.add(gi.gem.name);
  }
  const keystones = new Set(tree.summary.keystones);
  const hasGrace = activeGems.has('Grace');
  const hasDet = activeGems.has('Determination');
  const hasIR = keystones.has('Iron Reflexes');
  const hasGhostDance = keystones.has('Ghost Dance');
  const hasDivineShield = keystones.has('Divine Shield');
  const masteryTexts = tree.summary.masteries.map((m) => m.text.toLowerCase());
  const hasArmourMastery = masteryTexts.some((t) => t.includes('all have armour'));
  const hasEvaSuppressMastery = masteryTexts.some((t) => t.includes('all have evasion rating'));
  const cls = arch.classData.name;
  const t = arch.options.targets;
  const wantEvaTarget = (t?.minEvasion ?? 0) > 0 || (t?.minEvadePct ?? 0) > 0 || (t?.minSuppressPct ?? 0) > 0 || (t?.minDodgePct ?? 0) > 0;
  const wantArmTarget = (t?.minArmour ?? 0) > 0;

  if (arch.defenseStyle === 'hybrid') {
    if (wantArmTarget && !wantEvaTarget) return 'Armour/Energy Shield';
    if (hasGhostDance || wantEvaTarget || (hasGrace && !hasDet) || cls === 'Ranger' || cls === 'Shadow') {
      return 'Evasion/Energy Shield';
    }
    return 'Armour/Energy Shield';
  }

  if (arch.defenseStyle === 'es') {
    if (hasIR || hasDivineShield || hasArmourMastery || wantArmTarget || (hasDet && !hasGrace) || cls === 'Marauder' || cls === 'Duelist') {
      return 'Armour/Energy Shield';
    }
    if (hasGhostDance || hasEvaSuppressMastery || wantEvaTarget || (hasGrace && !hasDet) || cls === 'Ranger') {
      return 'Evasion/Energy Shield';
    }
    if (cls === 'Shadow') return rng.chance(0.55) ? 'Evasion/Energy Shield' : 'Energy Shield';
    if (cls === 'Templar') return rng.chance(0.55) ? 'Armour/Energy Shield' : 'Energy Shield';
    return 'Energy Shield';
  }

  // Life builds: align HP + Evasion -> Armour/Evasion, otherwise pick one consistent pure profile
  if (hasIR || (wantArmTarget && !wantEvaTarget)) return 'Armour';
  if (wantArmTarget && wantEvaTarget) return 'Armour/Evasion';
  if (wantEvaTarget) return arch.classData.name === 'Duelist' || hasDet ? 'Armour/Evasion' : 'Evasion';
  if (hasArmourMastery && hasEvaSuppressMastery) return 'Armour/Evasion';
  if (hasGrace && hasDet) return 'Armour/Evasion';
  if (cls === 'Duelist' && (hasGrace || arch.primaryAttr === 'dex')) return 'Armour/Evasion';
  if (arch.primaryAttr === 'dex' && hasDet) return 'Armour/Evasion';
  if (arch.primaryAttr === 'dex' || (hasGrace && !hasDet)) return 'Evasion';
  if (arch.damageStyle === 'minion' && arch.primaryAttr === 'int' && !wantArmTarget && !wantEvaTarget && !hasIR) {
    return rng.chance(0.75) ? 'Armour/Energy Shield' : 'Armour';
  }
  if (cls === 'Duelist' && !hasDet && !hasArmourMastery) {
    return rng.chance(0.5) ? 'Armour/Evasion' : 'Armour';
  }
  return 'Armour';
}

function pickBestBase(
  data: GameData,
  slotType: string,
  arch: BuildArchetype,
  hasCI: boolean,
  rng: Rng,
  opts: { allowedTypes?: string[]; preferSubType?: string; preferTags?: string[]; needs?: { str: number; dex: number; int: number; suppress?: number }; isEvasionBuild?: boolean } = {},
): [string, BaseData] {
  const isTrade = arch.options.economy === 'trade';
  const rawCandidates = Object.entries(data.bases).filter(([name, b]) => {
    if (opts.allowedTypes && !opts.allowedTypes.includes(b.type)) return false;
    if (!opts.allowedTypes && b.type !== slotType) return false;
    if (b.subType === 'Talisman') return false;
    const allowAtlas = b.tags.includes('atlas_base_type') && (isTrade || arch.options.level >= 72);
    if (b.tags.includes('not_for_sale') && b.type !== 'Jewel' && b.type !== 'Flask' && !allowAtlas) return false;
    // Skip ultra-restrictive ritual / heist / scourge oddities in SSF
    if (!isTrade && (b.tags.includes('ritual_base') || /Experimental|Astrolabe|Simplex|Focused|Cogwork|Geodesic|Helical|Kalandra/.test(name))) return false;
    const reqLvl = b.req.level ?? 1;
    if (reqLvl > arch.options.level) return false;
    return true;
  });

  const strictArmourMatches = opts.preferSubType && ARMOUR_SLOTS.has(slotType)
    ? rawCandidates.filter(([, b]) => b.subType === opts.preferSubType)
    : [];
  let candidates = strictArmourMatches.length > 0 ? strictArmourMatches : rawCandidates;

  // Minion wands strongly lock onto Calling / Convening / Convoking Wands when available at level.
  if (arch.damageStyle === 'minion' && (slotType === 'Wand' || opts.allowedTypes?.includes('Wand'))) {
    const minionWands = candidates.filter(([, b]) => b.tags.includes('weapon_can_roll_minion_modifiers'));
    if (minionWands.length > 0) candidates = minionWands;
  }

  const picked = rng.weighted(candidates, ([name, b]) => {
    const reqLvl = b.req.level ?? 1;
    let w = reqLvl >= 62 ? 12 : reqLvl >= 45 ? 4 : 0.4;
    if (b.tags.includes('top_tier_base_item_type')) w *= 2.5;

    // Match defensive attribute profile on armour pieces
    if (['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield'].includes(b.type)) {
      const evasionFocus = opts.isEvasionBuild ?? (arch.primaryAttr === 'dex' && arch.defenseStyle !== 'es');
      const wantArmour = arch.primaryAttr === 'str' || (arch.options.leagueMode === 'hardcore' && !evasionFocus);
      const wantEvasion = evasionFocus || arch.primaryAttr === 'dex';
      const wantES = arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid' || arch.primaryAttr === 'int';
      if (arch.defenseStyle === 'es') {
        if (b.subType === 'Energy Shield') w *= 14;
        else if (b.subType?.includes('Energy Shield')) w *= 4;
        else w *= 0.2;
      } else if (evasionFocus) {
        if (b.subType === 'Evasion') w *= (opts.needs?.suppress ?? 0) > 0 ? (arch.options.leagueMode === 'hardcore' ? 14 : 9) : 8;
        else if (b.subType?.includes('Evasion')) w *= arch.options.leagueMode === 'hardcore' ? 10 : 5;
        else w *= arch.options.leagueMode === 'hardcore' ? 0.15 : 0.35;
      } else {
        if (wantArmour && b.subType?.includes('Armour')) w *= 4;
        if (wantEvasion && b.subType?.includes('Evasion')) w *= 4;
        if (wantES && b.subType?.includes('Energy Shield')) w *= 3;
        if (b.subType === 'Ward') w *= 0.15;
      }
    }

    if (b.type === 'Wand' && arch.damageStyle !== 'attack') {
      if (b.tags.includes('wand_can_roll_caster_modifiers')) w *= 6;
    }
    if (arch.damageStyle === 'minion') {
      if (b.tags.includes('weapon_can_roll_minion_modifiers')) w = Math.max(w, 12) * 40;
      if (b.tags.includes('focus_can_roll_minion_modifiers')) w = Math.max(w, 12) * 24;
      if (b.tags.includes('ring_can_roll_minion_modifiers')) w = Math.max(w, 12) * 18;
      if (name === 'Bone Helmet') w = Math.max(w, 12) * 24;
      if (b.type === 'Ring' && !b.tags.includes('ring_can_roll_minion_modifiers') && /Steel|Opal|Iolite|Cerulean/.test(name)) {
        w *= 0.25;
      }
    }
    if (b.type === 'Belt' && name === 'Stygian Vise') w *= isTrade ? 5 : 2;
    if (b.type === 'Belt' && name === 'Leather Belt') w *= arch.defenseStyle === 'es' || hasCI ? 0.05 : (arch.defenseStyle === 'life' ? 3 : 1);
    if (b.type === 'Belt' && name === 'Crystal Belt' && arch.defenseStyle === 'es') w *= 6;
    if (b.type === 'Ring' && /Two-Stone|Opal|Diamond|Moonstone/.test(name)) w *= 3;
    if (b.type === 'Ring' && (name === 'Vermilion Ring' || name === 'Coral Ring')) w *= arch.defenseStyle === 'es' || hasCI ? 0.05 : 3;
    if (b.type === 'Ring' && name === 'Amethyst Ring') w *= hasCI ? 0.05 : (arch.options.leagueMode === 'hardcore' ? 12 : 3);
    if (b.type === 'Amulet' && name === 'Coral Amulet' && (arch.defenseStyle === 'es' || hasCI)) w *= 0.05;
    if (b.type === 'Amulet' && /Onyx|Agate|Turquoise|Citrine|Jade|Lapis|Amber/.test(name)) w *= 3;
    if (opts.needs && (b.type === 'Amulet' || b.type === 'Belt') && b.implicit) {
      const imp = b.implicit.toLowerCase();
      if (opts.needs.str > 0 && /strength|all attributes/.test(imp)) w *= 7;
      if (opts.needs.dex > 0 && /dexterity|all attributes/.test(imp)) w *= 7;
      if (opts.needs.int > 0 && /intelligence|all attributes/.test(imp)) w *= 7;
    }
    if (opts.preferSubType && b.subType === opts.preferSubType) w *= 8;
    if (opts.preferTags && opts.preferTags.some((t) => b.tags.includes(t))) w *= 5;
    return w;
  });

  if (!picked) {
    // Fallback
    const fb = Object.entries(data.bases).find(([, b]) => b.type === (opts.allowedTypes?.[0] ?? slotType));
    return fb!;
  }
  return picked;
}

function getUniqueActiveVariantLines(u: UniqueData): {
  variantNum?: number;
  implicits: string[];
  explicits: string[];
  cleanLines: string[];
} {
  let variantNum: number | undefined;
  if (u.variants && u.variants.length > 0) {
    const curIdx = u.variants.findIndex((v) => v === 'Current');
    variantNum = curIdx >= 0 ? curIdx + 1 : u.variants.length;
  }
  const byVariant = (lines: string[]) =>
    lines.filter((l) => {
      const vm = /^\{variant:([\d,]+)\}/.exec(l);
      if (!vm || !variantNum) return true;
      return vm[1].split(',').map(Number).includes(variantNum);
    });
  const implicits = byVariant(u.implicits);
  const explicits = byVariant(u.explicits);
  const cleanLines = [...implicits, ...explicits].map((l) => l.replace(/\{[^}]+\}/g, '').trim());
  return { variantNum, implicits, explicits, cleanLines };
}

function isUniqueSuitable(
  u: UniqueData,
  arch: BuildArchetype,
  slotTypes: string[],
  base?: BaseData,
  targetArmourSubType?: ArmourSubType,
  opts?: {
    manaReservedPct?: number;
    effectiveKeystones?: Set<string>;
    isEvasionBuild?: boolean;
  },
): boolean {
  if (!slotTypes.includes(u.type)) return false;
  if (targetArmourSubType && ARMOUR_SLOTS.has(u.type) && base?.subType !== targetArmourSubType) return false;
  if (u.levelReq && u.levelReq > arch.options.level) return false;
  if (base && arch.defenseStyle !== 'es') {
    if (arch.primaryAttr !== 'str' && (base.req.str ?? 0) > 180) return false;
    if (arch.primaryAttr !== 'dex' && (base.req.dex ?? 0) > 180) return false;
    if (arch.primaryAttr !== 'int' && (base.req.int ?? 0) > 180) return false;
  }
  if (arch.options.economy === 'ssf') {
    if (CHASE_OR_BOSS_UNIQUE.test(u.name)) return false;
    if (u.source && /Drops from unique\{|Uber|Pinnacle|Sirus|Maven|Elder|Shaper|Atziri|Cortex|Simulacrum|Heist|Sanctum|Delve|Expedition|Blight/i.test(u.source)) {
      return false;
    }
  }
  const { cleanLines } = getUniqueActiveVariantLines(u);
  const fullTxt = cleanLines.join(' ').toLowerCase();
  if (arch.options.leagueMode === 'hardcore') {
    if (HC_RISKY_UNIQUE.test(u.name)) return false;
    if (
      /damage(?: from hits)? taken as physical/.test(fullTxt)
      || /-\(?[\d-]+% to (?:all )?maximum .* resistanc/.test(fullTxt)
      || /your maximum resistances are \(?(?:[0-6]\d|7[0-4])/.test(fullTxt)
      || /elemental resistances are zero/.test(fullTxt)
    ) return false;
  }
  if (u.extra?.some((e) => /Limited to:/i.test(e))) return false;
  if (arch.defenseStyle === 'es' && /cannot have energy shield|blood magic/.test(fullTxt)) return false;
  if (arch.defenseStyle === 'life' && /chaos inoculation|maximum life becomes 1/.test(fullTxt)) return false;
  if (arch.critMode === 'crit' && /never deal critical strikes|critical strikes deal no damage/.test(fullTxt)) return false;
  if (arch.elements.includes('physical') && /deal no physical damage/.test(fullTxt)) return false;
  if (arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning') && /deal no elemental damage/.test(fullTxt)) return false;
  if (arch.elements.includes('chaos') && /deal no chaos damage/.test(fullTxt)) return false;
  if (/deal no non-lightning damage/.test(fullTxt) && !(arch.elements.length === 1 && arch.elements[0] === 'lightning')) return false;
  if (/deal no non-cold damage/.test(fullTxt) && !(arch.elements.length === 1 && arch.elements[0] === 'cold')) return false;
  if (/deal no non-fire damage/.test(fullTxt) && !(arch.elements.length === 1 && arch.elements[0] === 'fire')) return false;
  if (/deal no non-physical damage/.test(fullTxt) && !(arch.elements.length === 1 && arch.elements[0] === 'physical')) return false;
  if (/deal no non-elemental damage/.test(fullTxt) && (arch.elements.includes('physical') || arch.elements.includes('chaos'))) return false;
  if (/deal no physical or elemental damage/.test(fullTxt) && !(arch.elements.length === 1 && arch.elements[0] === 'chaos')) return false;
  if (arch.elements.includes('fire') && /deal no fire damage/.test(fullTxt)) return false;
  if (arch.elements.includes('cold') && /deal no cold damage/.test(fullTxt)) return false;
  if (arch.elements.includes('lightning') && /deal no lightning damage/.test(fullTxt)) return false;
  if (/summoned skeletons have avatar of fire/.test(fullTxt) && !(arch.damageStyle === 'minion' && /skeleton/i.test(arch.mainSkill.name) && arch.elements.includes('fire'))) return false;
  if (/raised zombies have avatar of fire/.test(fullTxt) && !(arch.damageStyle === 'minion' && /zombie/i.test(arch.mainSkill.name) && arch.elements.includes('fire'))) return false;
  if (/cannot use|deal no .* damage/.test(fullTxt) && /deal no (non-)?chaos|deal no elemental/.test(fullTxt)) return false;
  if (/your auras do not affect/.test(fullTxt)) return false;
  if (arch.damageStyle === 'minion' && !arch.mainSkill.types.includes('Attack') && base?.weapon && !/minion/i.test(fullTxt)) {
    return false;
  }

  const grantedKeystones = extractKeystonesFromLines(cleanLines);
  for (const ks of grantedKeystones) {
    if (
      !isKeystoneNameAllowed(ks, arch, opts?.manaReservedPct ?? 80, opts?.effectiveKeystones, {
        fromItem: true,
        isEvasionBuild: opts?.isEvasionBuild,
      })
    ) {
      return false;
    }
  }
  return true;
}

function scoreUniqueForArchetype(
  u: UniqueData,
  arch: BuildArchetype,
  base: BaseData | undefined,
  hasCI: boolean,
  maxRes: { fire: number; cold: number; lightning: number; chaos: number },
  opts?: { effectiveKeystones?: Set<string>; manaReservedPct?: number; isEvasionBuild?: boolean },
): number {
  const { cleanLines } = getUniqueActiveVariantLines(u);
  const txt = cleanLines.join(' ').toLowerCase();
  const isHC = arch.options.leagueMode === 'hardcore';
  const isTrade = arch.options.economy === 'trade';
  const reqLvl = u.levelReq ?? base?.req.level ?? 1;
  let s = reqLvl >= 50 ? 12 : reqLvl >= 30 ? 5 : 0.6;
  if (base) {
    if ((base.req.str ?? 0) > 165 && arch.primaryAttr !== 'str') s *= 0.05;
    if ((base.req.dex ?? 0) > 165 && arch.primaryAttr !== 'dex') s *= 0.05;
    if ((base.req.int ?? 0) > 165 && arch.primaryAttr !== 'int' && arch.defenseStyle !== 'es') s *= 0.05;
  }
  // Leveling weapons without endgame scaling are weak at lvl 90 (unless high-value conversion/max-res chest like Cloak of Flame in HC)
  const hasConversionOrMaxRes = /taken as (fire|cold|lightning|chaos) damage|to (?:all )?maximum .* resistance/.test(txt);
  if (base?.weapon && reqLvl < 40 && !/spell|minion|gems|aura/i.test(txt) && !(isHC && hasConversionOrMaxRes)) s *= 0.15;

  const offMult = isHC ? 0.7 : 2.1;
  if (arch.defenseStyle === 'es' && ['Body Armour', 'Shield', 'Helmet'].includes(u.type)) {
    const hasEsBase = Boolean(base?.armour?.EnergyShieldBaseMax) || /maximum energy shield|% increased.*energy shield/.test(txt);
    if (!hasEsBase) s *= 0.04;
  }
  if (arch.defenseStyle === 'life' && /maximum life/.test(txt)) s += isHC ? 14 : 4;
  if (arch.defenseStyle === 'es' && /maximum energy shield/.test(txt)) s += isHC ? 16 : 5;
  if (/to all elemental resistances|resistance/.test(txt)) s += isHC ? 12 : 4;
  const isEvasionArch = arch.primaryAttr === 'dex' && arch.defenseStyle !== 'es';
  if (isEvasionArch && ['Body Armour', 'Helmet', 'Gloves', 'Boots'].includes(u.type)) {
    const hasEvaBase = Boolean(base?.armour?.EvasionBaseMax);
    if (!hasEvaBase && !/suppress spell/.test(txt)) s *= isHC ? 0.08 : 0.25;
    if (hasEvaBase) s *= isHC ? 1.8 : 1.3;
  }
  if (/suppress spell/.test(txt)) s += isEvasionArch ? (isHC ? 45 : 14) : (isHC ? 18 : 4);

  // Hardcore max-hit, max-res & damage-taken conversion prioritization
  if (isHC) {
    if (/to all maximum elemental resistances/.test(txt)) s += isTrade ? 65 : 42;
    else if (/to maximum (fire|cold|lightning|chaos) resistance/.test(txt)) s += isTrade ? 42 : 28;
    if (/additional physical damage reduction/.test(txt)) s += 32;

    const takenMatches = txt.matchAll(/(\d+(?:-\d+)?\)?)% of (.+?) damage(?: from hits)? taken as (fire|cold|lightning|chaos) damage/g);
    for (const m of takenMatches) {
      const dst = m[3] as 'fire' | 'cold' | 'lightning' | 'chaos';
      if (dst === 'chaos') {
        if (hasCI) s += isTrade ? 130 : 75;
        else s *= 0.2;
      } else {
        const excess = Math.max(0, maxRes[dst] - 75);
        s += (isTrade ? 40 : 24) + excess * 12;
      }
    }
    if (/damage(?: from hits)? taken as physical/.test(txt)) return 0.01;
  }

  if (arch.damageStyle === 'attack' && /attack|weapon|physical/.test(txt)) s += 8 * offMult;
  if (arch.damageStyle === 'spell' && /spell|cast speed/.test(txt)) s += 8 * offMult;
  if (arch.damageStyle === 'minion' && /minion/.test(txt)) s += 32 * offMult;
  if (arch.damageStyle === 'totem' && /totem/.test(txt)) s += 15 * offMult;
  if (arch.damageStyle === 'trap_mine' && /trap|mine/.test(txt)) s += 15 * offMult;
  if (arch.damageStyle === 'dot' && /damage over time|ignite|poison|bleed/.test(txt)) s += 14 * offMult;
  if (arch.critMode === 'crit' && /critical/.test(txt) && (arch.damageStyle !== 'minion' || /minion/.test(txt))) s += 8 * offMult;
  if (arch.damageStyle !== 'minion') {
    for (const el of arch.elements) {
      if (txt.includes(el)) s += 6 * offMult;
    }
  }
  const grantedKeystones = extractKeystonesFromLines(cleanLines);
  for (const ks of grantedKeystones) {
    if (opts?.effectiveKeystones?.has(ks)) {
      s *= 0.85;
    } else if (
      isKeystoneNameAllowed(ks, arch, opts?.manaReservedPct ?? 80, opts?.effectiveKeystones, {
        fromItem: true,
        isEvasionBuild: opts?.isEvasionBuild,
      })
    ) {
      s += 16 * offMult;
    }
  }
  if (/level of all .* gems|movement speed/.test(txt)) s += 9 * (isHC ? 1 : 1.4);
  return s;
}

function buildUniqueItem(
  id: number,
  slot: string,
  u: UniqueData,
  base: BaseData,
  sockets: string | undefined,
  arch: BuildArchetype,
  rng: Rng,
): GeneratedItem {
  const isTrade = arch.options.economy === 'trade';
  const roll = isTrade ? rng.range(0.55, 0.95) : rng.range(0.3, 0.75);
  const { variantNum, implicits: rawImp, explicits: rawExp } = getUniqueActiveVariantLines(u);
  const resolveLines = (lines: string[]) =>
    lines.map((l) => applyRange(l.replace(/\{[^}]+\}/g, ''), roll));

  const implicits = resolveLines(rawImp);
  const explicits = resolveLines(rawExp);

  const rawLines: string[] = [
    'Rarity: UNIQUE',
    u.name,
    u.base,
  ];
  if (u.league) rawLines.push(`League: ${u.league}`);
  if (u.versions) {
    for (const v of u.versions) rawLines.push(`Version: ${v}`);
  }
  if (u.variants) {
    for (const v of u.variants) rawLines.push(`Variant: ${v}`);
    if (variantNum) rawLines.push(`Selected Variant: ${variantNum}`);
  }
  if (u.extra) rawLines.push(...u.extra);
  if (['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Bow', 'Staff', 'One Handed Sword', 'One Handed Axe', 'One Handed Mace', 'Two Handed Sword', 'Two Handed Axe', 'Two Handed Mace', 'Wand', 'Sceptre', 'Claw', 'Dagger'].includes(u.type)) {
    rawLines.push('Quality: 20');
  }
  if (sockets) rawLines.push(`Sockets: ${sockets}`);
  rawLines.push(`Implicits: ${u.implicits.length}`);
  for (const l of u.implicits) rawLines.push(l);
  for (const l of u.explicits) {
    const withRange = /\(\d+(?:\.\d+)?-\d+(?:\.\d+)?\)/.test(l) ? `{range:${roll.toFixed(3)}}${l}` : l;
    rawLines.push(withRange);
  }

  return {
    id,
    slot,
    rarity: 'UNIQUE',
    name: u.name,
    baseName: u.base,
    base,
    itemLevel: 85,
    quality: 20,
    sockets,
    variant: variantNum,
    implicits,
    explicits,
    prefixes: [],
    suffixes: [],
    rawText: rawLines.join('\n'),
  };
}

function buildRareItem(
  id: number,
  slot: string,
  baseName: string,
  base: BaseData,
  sockets: string | undefined,
  data: GameData,
  arch: BuildArchetype,
  needs: { fire: number; cold: number; lightning: number; chaos: number; str: number; dex: number; int: number; suppress: number },
  hasCI: boolean,
  maxRes: { fire: number; cold: number; lightning: number; chaos: number },
  rng: Rng,
  opts: { isJewel?: boolean; jewelNodeId?: number; isEvasionBuild?: boolean } = {},
): GeneratedItem {
  const isTrade = arch.options.economy === 'trade';
  const isHC = arch.options.leagueMode === 'hardcore';
  const ilvl = isTrade ? 86 : 82;
  const maxAffix = opts.isJewel ? 2 : 3;
  const modPool = opts.isJewel ? data.mods.jewel : data.mods.item;
  const itemTags = new Set(base.tags);
  const isWeapon = Boolean(base.weapon);

  // Filter mods that can spawn on this base at this ilvl
  const validMods = modPool.filter((m) => m.lvl <= ilvl && getModWeightForTags(m, itemTags) > 0);
  const minModLvl = isTrade ? 52 : 32;

  const prefixes: RolledAffix[] = [];
  const suffixes: RolledAffix[] = [];
  const usedGroups = new Set<string>();

  const targetPrefixes = opts.isJewel ? rng.pick([1, 2]) : (isTrade ? 3 : rng.pick([2, 3]));
  const targetSuffixes = opts.isJewel ? rng.pick([1, 2]) : (isTrade ? 3 : rng.pick([2, 3]));

  const rollRange = () => (isTrade ? rng.range(0.6, 0.95) : rng.range(0.25, 0.8));

  const pickAffix = (type: 'P' | 'S') => {
    const pool = validMods.filter(
      (m) => m.t === type && !usedGroups.has(m.group) && (m.lvl >= minModLvl || rng.chance(0.15)),
    );
    const chosen = rng.weighted(pool, (m) => {
      const baseW = getModWeightForTags(m, itemTags);
      const archW = scoreModForArchetype(m, arch, needs, isWeapon, hasCI, maxRes, Boolean(opts.isEvasionBuild));
      return Math.sqrt(baseW) * archW;
    });
    if (!chosen) return;
    usedGroups.add(chosen.group);
    const r = rollRange();
    const rolled: RolledAffix = {
      mod: chosen,
      range: r,
      resolvedLines: chosen.lines.map((l) => applyRange(l, r)),
    };
    if (type === 'P') prefixes.push(rolled);
    else suffixes.push(rolled);
  };

  // Reserve 1 slot for a deterministic crafting bench mod when non-jewel so life/max-hit/DPS/res is reliable
  const targets = arch.options.targets;
  const useBenchCraft = !opts.isJewel;
  const maxEleNeed = Math.max(needs.fire, needs.cold, needs.lightning);
  const hcNeedsResBench = isHC && maxEleNeed > 20;
  const wantLifeBench = !hcNeedsResBench && maxEleNeed <= 30
    && (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid')
    && !prefixes.some((p) => p.mod.group === 'IncreasedLife');
  const wantHcConversionBench = (isHC || (targets?.minPhysMaxHit ?? 0) > 0) && !hcNeedsResBench && (base.type === 'Helmet' || base.type === 'Body Armour')
    && (hasCI || (!wantLifeBench && (targets?.minHp ?? 0) === 0));
  const wantScDamageBench = (!isHC || (targets?.minDps ?? 0) > 0) && (isWeapon || base.type === 'Amulet' || base.type === 'Gloves' || base.type === 'Ring');
  const benchIsPrefix = wantLifeBench || wantHcConversionBench || ((!isHC || (targets?.minDps ?? 0) > 0) && maxEleNeed <= 25 && isWeapon);

  const rollPrefixCount = useBenchCraft && benchIsPrefix ? Math.min(maxAffix - 1, targetPrefixes) : targetPrefixes;
  const rollSuffixCount = useBenchCraft && !benchIsPrefix ? Math.min(maxAffix - 1, targetSuffixes) : targetSuffixes;

  for (let i = 0; i < rollPrefixCount; i++) pickAffix('P');
  for (let i = 0; i < rollSuffixCount; i++) pickAffix('S');

  // Crafting bench mod
  let craftedMod: string | undefined;
  if (useBenchCraft) {
    if (wantHcConversionBench && prefixes.length < maxAffix) {
      const targetEl = capWord(bestEleTarget(maxRes));
      const pct = isTrade ? 8 : 6;
      craftedMod = `${pct}% of Physical Damage from Hits taken as ${targetEl} Damage`;
    } else if (benchIsPrefix && isWeapon && arch.damageStyle === 'minion' && prefixes.length < maxAffix) {
      craftedMod = isTrade ? 'Minions deal 32% increased Damage' : 'Minions deal 22% increased Damage';
    } else if (benchIsPrefix && prefixes.length < maxAffix && !usedGroups.has('IncreasedLife')) {
      if (['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Ring', 'Amulet', 'Belt'].includes(base.type)) {
        const lifeVal = base.type === 'Body Armour' ? (isTrade ? 95 : 75) : (isTrade ? 70 : 55);
        craftedMod = `+${lifeVal} to maximum Life`;
      }
    }
    if (!craftedMod && suffixes.length < maxAffix) {
      if (needs.fire >= needs.cold && needs.fire >= needs.lightning && needs.fire > 0) {
        craftedMod = isHC && !hasCI && needs.fire <= 20 ? '+18% to Fire and Chaos Resistances' : '+35% to Fire Resistance';
      } else if (needs.cold >= needs.lightning && needs.cold > 0) {
        craftedMod = isHC && !hasCI && needs.cold <= 20 ? '+18% to Cold and Chaos Resistances' : '+35% to Cold Resistance';
      } else if (needs.lightning > 0) {
        craftedMod = isHC && !hasCI && needs.lightning <= 20 ? '+18% to Lightning and Chaos Resistances' : '+35% to Lightning Resistance';
      } else if ((needs.str > 0 || needs.dex > 0 || needs.int > 0) && ['Amulet', 'Ring', 'Belt', 'Helmet', 'Gloves', 'Boots'].includes(base.type)) {
        const missing = (['str', 'dex', 'int'] as const).filter((k) => needs[k] > 0);
        const labelMap = { str: 'Strength', dex: 'Dexterity', int: 'Intelligence' } as const;
        if (missing.length >= 2) {
          craftedMod = `+28 to ${labelMap[missing[0]]} and ${labelMap[missing[1]]}`;
        } else {
          craftedMod = `+50 to ${labelMap[missing[0]]}`;
        }
      } else if (isHC && !hasCI && needs.chaos > 0) {
        craftedMod = '+20% to Chaos Resistance';
      } else if (needs.suppress > 0 && (isHC || opts.isEvasionBuild) && (base.type === 'Boots' || base.type === 'Gloves' || base.type === 'Helmet') && !usedGroups.has('ChanceToSuppressSpells')) {
        craftedMod = '+10% chance to Suppress Spell Damage';
      } else if (wantScDamageBench && arch.critMode === 'crit' && arch.damageStyle !== 'minion') {
        craftedMod = isTrade ? '+25% to Global Critical Strike Multiplier' : '+18% to Global Critical Strike Multiplier';
      } else if (wantScDamageBench && arch.damageStyle === 'dot') {
        craftedMod = isTrade ? '+20% to Damage over Time Multiplier' : '+14% to Damage over Time Multiplier';
      } else if (isWeapon) {
        if (arch.damageStyle === 'minion') {
          craftedMod = isTrade ? 'Minions have 22% increased Attack and Cast Speed' : 'Minions have 16% increased Attack and Cast Speed';
        } else {
          craftedMod = arch.damageStyle === 'attack'
            ? (isTrade ? '27% increased Attack Speed' : '18% increased Attack Speed')
            : (isTrade ? '25% increased Cast Speed' : '17% increased Cast Speed');
        }
      } else if (!isHC && (base.type === 'Amulet' || base.type === 'Ring' || base.type === 'Gloves')) {
        if (arch.damageStyle === 'minion') {
          craftedMod = isTrade ? 'Minions deal 32% increased Damage' : 'Minions deal 22% increased Damage';
        } else if (arch.damageStyle === 'attack') {
          craftedMod = isTrade ? '25% increased Elemental Damage with Attack Skills' : '18% increased Elemental Damage with Attack Skills';
        } else {
          craftedMod = isTrade ? '30% increased Spell Damage' : '22% increased Spell Damage';
        }
      }
    }
    if (!craftedMod && isHC && prefixes.length < maxAffix && (base.type === 'Helmet' || base.type === 'Body Armour')) {
      const targetEl = capWord(bestEleTarget(maxRes));
      craftedMod = `${isTrade ? 8 : 6}% of Physical Damage from Hits taken as ${targetEl} Damage`;
    }
  }

  const name = `${rng.pick(RARE_FIRST)} ${rng.pick(RARE_SECOND)}`;
  const implicits = base.implicit ? [applyRange(base.implicit, rollRange())] : [];
  const explicits = [
    ...prefixes.flatMap((p) => p.resolvedLines),
    ...suffixes.flatMap((s) => s.resolvedLines),
    ...(craftedMod ? [`${craftedMod} (crafted)`] : []),
  ];

  const hasQuality = !opts.isJewel && !['Ring', 'Amulet', 'Belt', 'Quiver'].includes(base.type);
  const rawLines: string[] = [
    'Rarity: RARE',
    name,
    baseName,
    'Crafted: true',
    ...prefixes.map((p) => `Prefix: {range:${p.range.toFixed(3)}}${p.mod.id}`),
    ...suffixes.map((s) => `Suffix: {range:${s.range.toFixed(3)}}${s.mod.id}`),
    `Item Level: ${ilvl}`,
  ];
  if (hasQuality) rawLines.push('Quality: 20');
  if (sockets) rawLines.push(`Sockets: ${sockets}`);
  rawLines.push(`Implicits: ${implicits.length}`);
  if (base.implicit) rawLines.push(`{range:${rollRange().toFixed(3)}}${base.implicit}`);
  if (craftedMod) rawLines.push(`{crafted}${craftedMod}`);

  return {
    id,
    slot,
    jewelNodeId: opts.jewelNodeId,
    rarity: 'RARE',
    name,
    baseName,
    base,
    itemLevel: ilvl,
    quality: hasQuality ? 20 : undefined,
    sockets,
    implicits,
    explicits,
    prefixes,
    suffixes,
    craftedMod,
    rawText: rawLines.join('\n'),
  };
}

function buildFlask(
  id: number,
  slot: string,
  baseName: string,
  base: BaseData,
  data: GameData,
  arch: BuildArchetype,
  rng: Rng,
): GeneratedItem {
  const isTrade = arch.options.economy === 'trade';
  const isHC = arch.options.leagueMode === 'hardcore';
  const itemTags = new Set(base.tags);
  const validMods = data.mods.flask.filter((m) => m.lvl <= 84 && getModWeightForTags(m, itemTags) > 0);
  const roll = isTrade ? rng.range(0.65, 0.95) : rng.range(0.35, 0.8);

  const pickFlaskMod = (t: 'P' | 'S') => {
    const pool = validMods.filter((m) => m.t === t);
    return rng.weighted(pool, (m) => {
      const txt = m.lines.join(' ').toLowerCase();
      let w = getModWeightForTags(m, itemTags) * (m.lvl >= 60 ? 3 : 1);
      if (base.subType === 'Life' && /instant/.test(txt)) w *= isHC ? 8 : 5;
      if (base.subType === 'Life' && /bleeding|corrupted blood/.test(txt)) w *= 10;
      if (base.subType === 'Utility' && /armour|evasion/.test(txt)) w *= isHC ? 6 : 3;
      if (base.subType === 'Utility' && /movement speed/.test(txt)) w *= 5;
      if (base.subType === 'Utility' && /critical strike/.test(txt) && arch.critMode === 'crit') w *= 6;
      if (base.subType === 'Utility' && /curse/.test(txt)) w *= isHC ? 6 : 3;
      if (/charges/.test(txt)) w *= 3;
      return w;
    });
  };

  const pre = pickFlaskMod('P');
  const suf = pickFlaskMod('S');
  const prefixes: RolledAffix[] = pre ? [{ mod: pre, range: roll, resolvedLines: pre.lines.map((l) => applyRange(l, roll)) }] : [];
  const suffixes: RolledAffix[] = suf ? [{ mod: suf, range: roll, resolvedLines: suf.lines.map((l) => applyRange(l, roll)) }] : [];

  const title = `${pre ? pre.affix + ' ' : ''}${baseName}${suf ? ' ' + suf.affix : ''}`;
  const rawLines = [
    'Rarity: MAGIC',
    title,
    baseName,
    'Crafted: true',
    ...(pre ? [`Prefix: {range:${roll.toFixed(3)}}${pre.id}`] : []),
    ...(suf ? [`Suffix: {range:${roll.toFixed(3)}}${suf.id}`] : []),
    'Item Level: 85',
    'Quality: 20',
    'Implicits: 0',
  ];

  return {
    id,
    slot,
    rarity: 'MAGIC',
    name: title,
    baseName,
    base,
    itemLevel: 85,
    quality: 20,
    implicits: [],
    explicits: [...prefixes.flatMap((p) => p.resolvedLines), ...suffixes.flatMap((s) => s.resolvedLines)],
    prefixes,
    suffixes,
    rawText: rawLines.join('\n'),
  };
}

function tallyModsStats(
  lines: string[],
  resists: { fire: number; cold: number; lightning: number; chaos: number },
  attrs: { str: number; dex: number; int: number },
  maxRes?: { fire: number; cold: number; lightning: number; chaos: number },
) {
  for (const rawLine of lines) {
    const l = rawLine.replace(/\{[^}]+\}/g, '');
    if (maxRes && !/minions|during effect|if equipped|if you have reserved/i.test(l)) {
      const mAllEleMax = /([+-]\d+)% to all maximum Elemental Resistances/i.exec(l);
      if (mAllEleMax) {
        const v = Number(mAllEleMax[1]);
        maxRes.fire = Math.min(90, maxRes.fire + v);
        maxRes.cold = Math.min(90, maxRes.cold + v);
        maxRes.lightning = Math.min(90, maxRes.lightning + v);
      }
      const mAllMax = /([+-]\d+)% to all maximum Resistances/i.exec(l);
      if (mAllMax) {
        const v = Number(mAllMax[1]);
        maxRes.fire = Math.min(90, maxRes.fire + v);
        maxRes.cold = Math.min(90, maxRes.cold + v);
        maxRes.lightning = Math.min(90, maxRes.lightning + v);
        maxRes.chaos = Math.min(90, maxRes.chaos + v);
      }
      const mMaxF = /([+-]\d+)% to maximum Fire Resistance/i.exec(l);
      if (mMaxF) maxRes.fire = Math.min(90, maxRes.fire + Number(mMaxF[1]));
      const mMaxC = /([+-]\d+)% to maximum Cold Resistance/i.exec(l);
      if (mMaxC) maxRes.cold = Math.min(90, maxRes.cold + Number(mMaxC[1]));
      const mMaxL = /([+-]\d+)% to maximum Lightning Resistance/i.exec(l);
      if (mMaxL) maxRes.lightning = Math.min(90, maxRes.lightning + Number(mMaxL[1]));
      const mMaxCh = /([+-]\d+)% to maximum Chaos Resistance/i.exec(l);
      if (mMaxCh) maxRes.chaos = Math.min(90, maxRes.chaos + Number(mMaxCh[1]));
      const mLock = /Your Maximum Resistances are (\d+)%/i.exec(l);
      if (mLock) {
        const cap = Number(mLock[1]);
        maxRes.fire = cap; maxRes.cold = cap; maxRes.lightning = cap; maxRes.chaos = cap;
      }
    }
    const mAllRes = /\+(-?\d+)% to all Elemental Resistances/i.exec(l);
    if (mAllRes) {
      const v = Number(mAllRes[1]);
      resists.fire += v; resists.cold += v; resists.lightning += v;
    }
    const mFire = /\+(-?\d+)% to Fire(?: and (\w+))? Resistance/i.exec(l);
    if (mFire) {
      const v = Number(mFire[1]);
      resists.fire += v;
      if (mFire[2]?.toLowerCase() === 'cold') resists.cold += v;
      if (mFire[2]?.toLowerCase() === 'lightning') resists.lightning += v;
      if (mFire[2]?.toLowerCase() === 'chaos') resists.chaos += v;
    }
    const mCold = /\+(-?\d+)% to Cold(?: and (\w+))? Resistance/i.exec(l);
    if (mCold) {
      const v = Number(mCold[1]);
      resists.cold += v;
      if (mCold[2]?.toLowerCase() === 'lightning') resists.lightning += v;
      if (mCold[2]?.toLowerCase() === 'chaos') resists.chaos += v;
    }
    const mLight = /\+(-?\d+)% to Lightning(?: and (\w+))? Resistance/i.exec(l);
    if (mLight) {
      const v = Number(mLight[1]);
      resists.lightning += v;
      if (mLight[2]?.toLowerCase() === 'chaos') resists.chaos += v;
    }
    const mChaos = /\+(-?\d+)% to Chaos Resistance/i.exec(l);
    if (mChaos) resists.chaos += Number(mChaos[1]);

    const mAllAttr = /\+(\d+) to all Attributes/i.exec(l);
    if (mAllAttr) {
      const v = Number(mAllAttr[1]);
      attrs.str += v; attrs.dex += v; attrs.int += v;
    }
    const mStr = /\+(\d+) to Strength(?: and (\w+))?/i.exec(l);
    if (mStr) {
      const v = Number(mStr[1]);
      attrs.str += v;
      if (mStr[2]?.toLowerCase() === 'dexterity') attrs.dex += v;
      if (mStr[2]?.toLowerCase() === 'intelligence') attrs.int += v;
    }
    const mDex = /\+(\d+) to Dexterity(?: and (\w+))?/i.exec(l);
    if (mDex) {
      const v = Number(mDex[1]);
      attrs.dex += v;
      if (mDex[2]?.toLowerCase() === 'intelligence') attrs.int += v;
    }
    const mInt = /\+(\d+) to Intelligence/i.exec(l);
    if (mInt) attrs.int += Number(mInt[1]);
  }
}

function rebuildRareItem(it: GeneratedItem): void {
  it.explicits = [
    ...it.prefixes.flatMap((p) => p.resolvedLines),
    ...it.suffixes.flatMap((s) => s.resolvedLines),
    ...(it.craftedMod ? [`${it.craftedMod} (crafted)`] : []),
  ];
  const hasQuality = !it.jewelNodeId && !['Ring', 'Amulet', 'Belt', 'Quiver'].includes(it.base.type);
  const rawLines: string[] = [
    'Rarity: RARE',
    it.name,
    it.baseName,
    'Crafted: true',
    ...it.prefixes.map((p) => `Prefix: {range:${p.range.toFixed(3)}}${p.mod.id}`),
    ...it.suffixes.map((s) => `Suffix: {range:${s.range.toFixed(3)}}${s.mod.id}`),
    `Item Level: ${it.itemLevel}`,
  ];
  if (hasQuality) rawLines.push('Quality: 20');
  if (it.sockets) rawLines.push(`Sockets: ${it.sockets}`);
  rawLines.push(`Implicits: ${it.implicits.length}`);
  if (it.base.implicit) rawLines.push(`{range:0.750}${it.base.implicit}`);
  if (it.craftedMod) rawLines.push(`{crafted}${it.craftedMod}`);
  it.rawText = rawLines.join('\n');
}

function getSlotDefsForArchetype(arch: BuildArchetype): { slot: ItemSlotName; types: string[]; defaultSockets?: string }[] {
  return [
    { slot: 'Weapon 1', types: arch.allowedWeaponTypes, defaultSockets: 'R-G-B' },
    ...(arch.weaponSetup === 'bow_quiver'
      ? [{ slot: 'Weapon 2' as ItemSlotName, types: ['Quiver'] }]
      : arch.weaponSetup === 'one_hand_shield' || arch.weaponSetup === 'wand_shield'
        ? [{ slot: 'Weapon 2' as ItemSlotName, types: ['Shield'], defaultSockets: 'R-G-B' }]
        : arch.weaponSetup === 'dual_wield'
          ? [{ slot: 'Weapon 2' as ItemSlotName, types: arch.allowedWeaponTypes, defaultSockets: 'R-G-B' }]
          : []),
    { slot: 'Helmet', types: ['Helmet'], defaultSockets: 'R-R-G-B' },
    { slot: 'Body Armour', types: ['Body Armour'], defaultSockets: 'R-R-G-G-B-B' },
    { slot: 'Gloves', types: ['Gloves'], defaultSockets: 'R-G-B-B' },
    { slot: 'Boots', types: ['Boots'], defaultSockets: 'R-G-G-B' },
    { slot: 'Amulet', types: ['Amulet'] },
    { slot: 'Ring 1', types: ['Ring'] },
    { slot: 'Ring 2', types: ['Ring'] },
    { slot: 'Belt', types: ['Belt'] },
  ];
}

function getFlaskSpecs(
  arch: BuildArchetype,
  maxRes: { fire: number; cold: number; lightning: number; chaos: number },
  isHC: boolean,
  hasCI: boolean,
  isEvasionBuild: boolean,
  wantChaosCap: boolean,
): { slot: ItemSlotName; bases: string[] }[] {
  const bestEle = bestEleTarget(maxRes);
  const bestEleFlask = bestEle === 'fire' ? 'Ruby Flask' : bestEle === 'cold' ? 'Sapphire Flask' : 'Topaz Flask';
  const t = arch.options.targets;
  const wantEvaFlask = (t?.minEvasion ?? 0) > 0 || (t?.minEvadePct ?? 0) > 0 || (t?.minDodgePct ?? 0) > 0;
  const wantArmFlask = (t?.minArmour ?? 0) > 0;
  const wantCritFlask = (t?.minCritChancePct ?? 0) > 0;
  return arch.defenseStyle === 'es'
    ? [
        { slot: 'Flask 1', bases: ['Quicksilver Flask'] },
        { slot: 'Flask 2', bases: wantCritFlask ? ['Diamond Flask'] : wantArmFlask ? ['Granite Flask'] : (isHC ? ['Granite Flask', 'Basalt Flask'] : ['Diamond Flask', 'Silver Flask']) },
        { slot: 'Flask 3', bases: wantArmFlask ? ['Granite Flask', 'Basalt Flask'] : wantEvaFlask ? ['Jade Flask'] : ['Granite Flask', 'Basalt Flask'] },
        { slot: 'Flask 4', bases: wantEvaFlask ? ['Jade Flask'] : (isHC ? ['Jade Flask', bestEleFlask] : ['Jade Flask', 'Quartz Flask', 'Sulphur Flask']) },
        { slot: 'Flask 5', bases: hasCI ? [bestEleFlask, 'Ruby Flask', 'Sapphire Flask', 'Topaz Flask'] : ['Amethyst Flask', bestEleFlask] },
      ]
    : [
        { slot: 'Flask 1', bases: ['Divine Life Flask', 'Eternal Life Flask'] },
        { slot: 'Flask 2', bases: ['Quicksilver Flask'] },
        { slot: 'Flask 3', bases: wantEvaFlask ? ['Jade Flask'] : wantArmFlask ? ['Granite Flask'] : isEvasionBuild ? ['Jade Flask', 'Quartz Flask'] : (isHC ? ['Granite Flask', 'Basalt Flask'] : [arch.critMode === 'crit' || wantCritFlask ? 'Diamond Flask' : 'Silver Flask', 'Sulphur Flask']) },
        { slot: 'Flask 4', bases: wantCritFlask ? ['Diamond Flask'] : isEvasionBuild ? (isHC ? ['Basalt Flask', bestEleFlask, 'Quartz Flask'] : ['Diamond Flask', 'Silver Flask', 'Quartz Flask']) : (isHC ? ['Jade Flask', bestEleFlask, 'Basalt Flask'] : ['Silver Flask', 'Jade Flask', 'Quartz Flask']) },
        { slot: 'Flask 5', bases: wantArmFlask && !wantEvaFlask ? ['Granite Flask', 'Basalt Flask'] : isHC || wantChaosCap ? ['Amethyst Flask', bestEleFlask] : ['Diamond Flask', 'Sulphur Flask', 'Amethyst Flask'] },
      ];
}

function patchGearDeficits(
  data: GameData,
  arch: BuildArchetype,
  targetItems: GeneratedItem[],
  resists: { fire: number; cold: number; lightning: number; chaos: number },
  attrs: { str: number; dex: number; int: number },
  maxRes: { fire: number; cold: number; lightning: number; chaos: number },
  reqAttrs: { str: number; dex: number; int: number },
  currentSuppressIn: number,
  suppressTarget: number,
  hasCI: boolean,
  wantChaosCap: boolean,
  isEvasionBuild: boolean,
): void {
  const isTrade = arch.options.economy === 'trade';
  const dummyAttrs = { str: 0, dex: 0, int: 0 };
  let currentSuppress = currentSuppressIn;

  const countSuppressLines = (lines: string[]) => {
    let sum = 0;
    for (const raw of lines) {
      const m = /\+(\d+)% chance to Suppress Spell Damage\b(?! (?:while|if|for))/i.exec(raw);
      if (m) sum += Number(m[1]);
    }
    return sum;
  };

  const patchSlotPriority = (it: GeneratedItem) => {
    if (['Boots', 'Gloves', 'Helmet', 'Body Armour', 'Belt'].includes(it.slot)) return 0;
    if (it.slot === 'Ring 1' || it.slot === 'Ring 2') return 1;
    if (it.slot === 'Weapon 2' && it.base.type === 'Shield') return 1;
    if (it.slot === 'Amulet') return 2;
    return 3;
  };
  const orderedPatchRares = () =>
    targetItems
      .filter((it) => it.rarity === 'RARE' && !it.jewelNodeId && it.base.type !== 'Flask')
      .sort((a, b) => patchSlotPriority(a) - patchSlotPriority(b));

  const canSafelyRemoveLines = (lines: string[]) => {
    const delta = { fire: 0, cold: 0, lightning: 0, chaos: 0 };
    const attrDelta = { str: 0, dex: 0, int: 0 };
    tallyModsStats(lines, delta, attrDelta);
    if (resists.fire - delta.fire < maxRes.fire) return false;
    if (resists.cold - delta.cold < maxRes.cold) return false;
    if (resists.lightning - delta.lightning < maxRes.lightning) return false;
    if (wantChaosCap && !hasCI && resists.chaos - delta.chaos < maxRes.chaos) return false;
    return { delta, attrDelta };
  };

  const capTargets: ('fire' | 'cold' | 'lightning' | 'chaos')[] = wantChaosCap && !hasCI
    ? ['fire', 'cold', 'lightning', 'chaos']
    : ['fire', 'cold', 'lightning'];
  const untally = (lines: string[]) => {
    const delta = { fire: 0, cold: 0, lightning: 0, chaos: 0 };
    const attrDelta = { str: 0, dex: 0, int: 0 };
    tallyModsStats(lines, delta, attrDelta);
    resists.fire -= delta.fire;
    resists.cold -= delta.cold;
    resists.lightning -= delta.lightning;
    resists.chaos -= delta.chaos;
    attrs.str -= attrDelta.str;
    attrs.dex -= attrDelta.dex;
    attrs.int -= attrDelta.int;
  };

  const safeCraftReplace = (it: GeneratedItem, missing: 'fire' | 'cold' | 'lightning' | 'chaos') => {
    if (!it.craftedMod) return true;
    const delta = { fire: 0, cold: 0, lightning: 0, chaos: 0 };
    const attrDelta = { str: 0, dex: 0, int: 0 };
    tallyModsStats([it.craftedMod], delta, attrDelta);
    if (missing !== 'fire' && delta.fire > 0 && resists.fire - delta.fire < maxRes.fire) return false;
    if (missing !== 'cold' && delta.cold > 0 && resists.cold - delta.cold < maxRes.cold) return false;
    if (missing !== 'lightning' && delta.lightning > 0 && resists.lightning - delta.lightning < maxRes.lightning) return false;
    if (missing !== 'chaos' && wantChaosCap && !hasCI && delta.chaos > 0 && resists.chaos - delta.chaos < maxRes.chaos) return false;
    return true;
  };

  for (let pass = 0; pass < 28; pass++) {
    const missing = capTargets.find((el) => resists[el] < maxRes[el]);
    if (!missing) break;
    const targetCap = capWord(missing);
    const craftLine = missing === 'chaos' ? '+20% to Chaos Resistance' : `+35% to ${targetCap} Resistance`;
    const resRe = missing === 'chaos'
      ? /to chaos resistance/i
      : new RegExp(`to ${missing} resistance|to all elemental resistances`, 'i');
    let fixed = false;
    const patchRares = orderedPatchRares();

    if (missing !== 'chaos') {
      for (const it of patchRares) {
        if (it.suffixes.length < 3 && (!it.craftedMod || !resRe.test(it.craftedMod))) {
          if (it.base.weapon && it.craftedMod) continue;
          if (!safeCraftReplace(it, missing)) continue;
          const oldCraft = it.craftedMod ? [it.craftedMod] : [];
          untally(oldCraft);
          it.craftedMod = craftLine;
          tallyModsStats([craftLine], resists, dummyAttrs);
          rebuildRareItem(it);
          fixed = true;
          break;
        }
      }
      if (fixed) continue;
    }

    const modRe = missing === 'chaos'
      ? /^\+.*to Chaos Resistance$/i
      : new RegExp(`to ${missing} resistance$`, 'i');
    for (const preserveCombat of [true, false]) {
      for (const it of patchRares) {
        const itemTags = new Set(it.base.tags);
        const modMatch = data.mods.item
          .filter((m) =>
            m.t === 'S'
            && m.lvl <= it.itemLevel
            && getModWeightForTags(m, itemTags) > 0
            && !it.suffixes.some((s) => s.mod.group === m.group)
            && modRe.test(m.lines.join(' ')),
          )
          .sort((a, b) => b.lvl - a.lvl)[0];
        if (!modMatch) continue;

        const replaceIdx = it.suffixes.findIndex((s) => {
          const sl = s.resolvedLines.join(' ').toLowerCase();
          if (resRe.test(sl)) return false;
          const delta = { fire: 0, cold: 0, lightning: 0, chaos: 0 };
          const attrDelta = { str: 0, dex: 0, int: 0 };
          tallyModsStats(s.resolvedLines, delta, attrDelta);
          if (delta.fire > 0 && resists.fire - delta.fire < maxRes.fire) return false;
          if (delta.cold > 0 && resists.cold - delta.cold < maxRes.cold) return false;
          if (delta.lightning > 0 && resists.lightning - delta.lightning < maxRes.lightning) return false;
          if (wantChaosCap && !hasCI && delta.chaos > 0 && resists.chaos - delta.chaos < maxRes.chaos) return false;
          if (preserveCombat && /suppress|maximum .* resistance|physical damage reduction|critical strike|attack speed|cast speed/i.test(sl)) {
            return false;
          }
          if (!preserveCombat && /maximum .* resistance|physical damage reduction/i.test(sl)) return false;
          return true;
        });
        if (replaceIdx >= 0) {
          untally(it.suffixes[replaceIdx].resolvedLines);
          const range = missing === 'chaos' ? 0.95 : 0.85;
          const newSuf: RolledAffix = {
            mod: modMatch,
            range,
            resolvedLines: modMatch.lines.map((l) => applyRange(l, range)),
          };
          it.suffixes[replaceIdx] = newSuf;
          tallyModsStats(newSuf.resolvedLines, resists, dummyAttrs);
          rebuildRareItem(it);
          fixed = true;
          break;
        }
      }
      if (fixed) break;
    }
    if (!fixed && missing === 'chaos') {
      for (const it of patchRares) {
        if (it.suffixes.length < 3 && (!it.craftedMod || !resRe.test(it.craftedMod)) && safeCraftReplace(it, missing)) {
          if (it.base.weapon && it.craftedMod) continue;
          untally(it.craftedMod ? [it.craftedMod] : []);
          it.craftedMod = craftLine;
          tallyModsStats([craftLine], resists, dummyAttrs);
          rebuildRareItem(it);
          fixed = true;
          break;
        }
      }
    }
    if (!fixed && missing === 'chaos') {
      const jewelChaosMod = data.mods.jewel.find((m) => m.group === 'ChaosResistanceForJewel');
      if (jewelChaosMod) {
        for (const it of targetItems) {
          if (!it.jewelNodeId || it.rarity !== 'RARE') continue;
          if (it.suffixes.some((s) => s.mod.group === 'ChaosResistanceForJewel')) continue;
          const replaceIdx = it.suffixes.findIndex((s) => {
            const delta = { fire: 0, cold: 0, lightning: 0, chaos: 0 };
            const attrDelta = { str: 0, dex: 0, int: 0 };
            tallyModsStats(s.resolvedLines, delta, attrDelta);
            if (delta.fire > 0 && resists.fire - delta.fire < maxRes.fire) return false;
            if (delta.cold > 0 && resists.cold - delta.cold < maxRes.cold) return false;
            if (delta.lightning > 0 && resists.lightning - delta.lightning < maxRes.lightning) return false;
            return true;
          });
          if (replaceIdx >= 0) {
            untally(it.suffixes[replaceIdx].resolvedLines);
            const r = 0.95;
            const added: RolledAffix = { mod: jewelChaosMod, range: r, resolvedLines: jewelChaosMod.lines.map((l) => applyRange(l, r)) };
            it.suffixes[replaceIdx] = added;
            tallyModsStats(added.resolvedLines, resists, dummyAttrs);
            rebuildRareItem(it);
            fixed = true;
            break;
          }
        }
      }
    }
    if (!fixed) {
      for (const it of patchRares) {
        if (it.suffixes.length < 3 && (!it.craftedMod || !resRe.test(it.craftedMod)) && safeCraftReplace(it, missing)) {
          untally(it.craftedMod ? [it.craftedMod] : []);
          it.craftedMod = craftLine;
          tallyModsStats([craftLine], resists, dummyAttrs);
          rebuildRareItem(it);
          fixed = true;
          break;
        }
      }
    }
    if (!fixed) break;
  }

  const attrList = ['str', 'dex', 'int'] as const;
  const attrNameMap = { str: 'Strength', dex: 'Dexterity', int: 'Intelligence' } as const;

  for (let pass = 0; pass < 12; pass++) {
    const deficits = attrList
      .map((k) => ({ k, need: reqAttrs[k] - attrs[k] }))
      .filter((x) => x.need > 0)
      .sort((a, b) => b.need - a.need);
    if (deficits.length === 0) break;

    const topAttr = deficits[0].k;
    const secondAttr = deficits[1]?.k;
    const craftLine = secondAttr && deficits[0].need <= 28 && deficits[1].need <= 28
      ? `+28 to ${attrNameMap[topAttr]} and ${attrNameMap[secondAttr]}`
      : `+55 to ${attrNameMap[topAttr]}`;
    let patched = false;

    const breaksOtherAttr = (attrDelta: { str: number; dex: number; int: number }) =>
      attrList.some((k) => k !== topAttr && attrDelta[k] > 0 && attrs[k] - attrDelta[k] < reqAttrs[k]);

    for (const it of targetItems) {
      if (it.rarity !== 'RARE' || it.jewelNodeId || it.base.type === 'Flask') continue;
      if (it.suffixes.length >= 3) continue;
      if (it.craftedMod) {
        const cl = it.craftedMod.toLowerCase();
        if (cl.includes(attrNameMap[topAttr].toLowerCase()) || cl.includes('all attributes')) continue;
        const safe = canSafelyRemoveLines([it.craftedMod]);
        if (!safe || breaksOtherAttr(safe.attrDelta)) continue;
        resists.fire -= safe.delta.fire; resists.cold -= safe.delta.cold; resists.lightning -= safe.delta.lightning; resists.chaos -= safe.delta.chaos;
        attrs.str -= safe.attrDelta.str; attrs.dex -= safe.attrDelta.dex; attrs.int -= safe.attrDelta.int;
      }
      it.craftedMod = craftLine;
      tallyModsStats([craftLine], resists, attrs);
      rebuildRareItem(it);
      patched = true;
      break;
    }
    if (patched) continue;

    const targetName = attrNameMap[topAttr];
    for (const it of targetItems) {
      if (it.rarity !== 'RARE' || it.jewelNodeId || it.base.type === 'Flask') continue;
      const itemTags = new Set(it.base.tags);
      const attrMod = data.mods.item
        .filter((m) =>
          m.t === 'S'
          && m.lvl <= it.itemLevel
          && getModWeightForTags(m, itemTags) > 0
          && !it.suffixes.some((s) => s.mod.group === m.group)
          && new RegExp(`to (?:${targetName}|all Attributes)$`, 'i').test(m.lines.join(' ')),
        )
        .sort((a, b) => b.lvl - a.lvl)[0];
      if (!attrMod) continue;

      const replaceIdx = it.suffixes.findIndex((s) => {
        const sl = s.resolvedLines.join(' ').toLowerCase();
        if (sl.includes(targetName.toLowerCase()) || /all attributes|suppress|maximum .* resistance|physical damage reduction/.test(sl)) return false;
        const safe = canSafelyRemoveLines(s.resolvedLines);
        return Boolean(safe && !breaksOtherAttr(safe.attrDelta));
      });
      if (replaceIdx < 0) continue;

      const removed = it.suffixes[replaceIdx];
      const safe = canSafelyRemoveLines(removed.resolvedLines);
      if (!safe) continue;
      resists.fire -= safe.delta.fire; resists.cold -= safe.delta.cold; resists.lightning -= safe.delta.lightning; resists.chaos -= safe.delta.chaos;
      attrs.str -= safe.attrDelta.str; attrs.dex -= safe.attrDelta.dex; attrs.int -= safe.attrDelta.int;
      const r = 0.85;
      const added: RolledAffix = { mod: attrMod, range: r, resolvedLines: attrMod.lines.map((l) => applyRange(l, r)) };
      it.suffixes[replaceIdx] = added;
      tallyModsStats(added.resolvedLines, resists, attrs);
      rebuildRareItem(it);
      patched = true;
      break;
    }
    if (!patched) break;
  }

  if (isEvasionBuild && currentSuppress < suppressTarget) {
    const safeForAttrsAndRes = (lines: string[]) => {
      const safe = canSafelyRemoveLines(lines);
      if (!safe) return false;
      for (const k of attrList) {
        if (safe.attrDelta[k] > 0 && attrs[k] - safe.attrDelta[k] < reqAttrs[k]) return false;
      }
      return safe;
    };

    for (let pass = 0; pass < 6 && currentSuppress < suppressTarget; pass++) {
      let upgraded = false;
      for (const it of targetItems) {
        if (it.rarity !== 'RARE' || it.jewelNodeId || it.base.type === 'Flask') continue;
        const itemTags = new Set(it.base.tags);
        const suppMod = data.mods.item
          .filter((m) =>
            m.t === 'S'
            && m.lvl <= it.itemLevel
            && getModWeightForTags(m, itemTags) > 0
            && !it.suffixes.some((s) => s.mod.group === m.group)
            && /chance to Suppress Spell Damage$/i.test(m.lines.join(' ')),
          )
          .sort((a, b) => b.lvl - a.lvl)[0];

        if (suppMod) {
          const replaceIdx = it.suffixes.findIndex((s) => {
            const sl = s.resolvedLines.join(' ').toLowerCase();
            if (/suppress|maximum .* resistance|physical damage reduction/.test(sl)) return false;
            return Boolean(safeForAttrsAndRes(s.resolvedLines));
          });
          if (replaceIdx >= 0) {
            const safe = safeForAttrsAndRes(it.suffixes[replaceIdx].resolvedLines);
            if (safe) {
              resists.fire -= safe.delta.fire; resists.cold -= safe.delta.cold; resists.lightning -= safe.delta.lightning; resists.chaos -= safe.delta.chaos;
              attrs.str -= safe.attrDelta.str; attrs.dex -= safe.attrDelta.dex; attrs.int -= safe.attrDelta.int;
              const r = isTrade ? 0.85 : 0.65;
              const added: RolledAffix = { mod: suppMod, range: r, resolvedLines: suppMod.lines.map((l) => applyRange(l, r)) };
              it.suffixes[replaceIdx] = added;
              tallyModsStats(added.resolvedLines, resists, attrs);
              currentSuppress += countSuppressLines(added.resolvedLines);
              rebuildRareItem(it);
              upgraded = true;
              break;
            }
          }
        }

        if (['Boots', 'Gloves', 'Helmet'].includes(it.base.type) && it.suffixes.length < 3) {
          if (it.suffixes.some((s) => s.mod.group === 'ChanceToSuppressSpells')) continue;
          if (it.craftedMod && /suppress|maximum life|taken as/i.test(it.craftedMod)) continue;
          const safe = it.craftedMod ? safeForAttrsAndRes([it.craftedMod]) : { delta: { fire: 0, cold: 0, lightning: 0, chaos: 0 }, attrDelta: { str: 0, dex: 0, int: 0 } };
          if (!safe) continue;
          resists.fire -= safe.delta.fire; resists.cold -= safe.delta.cold; resists.lightning -= safe.delta.lightning; resists.chaos -= safe.delta.chaos;
          attrs.str -= safe.attrDelta.str; attrs.dex -= safe.attrDelta.dex; attrs.int -= safe.attrDelta.int;
          it.craftedMod = '+10% chance to Suppress Spell Damage';
          currentSuppress += 10;
          rebuildRareItem(it);
          upgraded = true;
          break;
        }
      }
      if (!upgraded) break;
    }
  }
}

export function generateGear(
  data: GameData,
  arch: BuildArchetype,
  tree: GeneratedTree,
  skills: GeneratedSkills,
  rng: Rng,
): GeneratedGear {
  const isTrade = arch.options.economy === 'trade';
  const isHC = arch.options.leagueMode === 'hardcore';
  const hasCI = tree.summary.keystones.includes('Chaos Inoculation');
  const wantChaosCap = isHC || (arch.options.targets?.minChaosMaxHit ?? 0) > 0;
  const targetChaosRes = hasCI ? -999 : (wantChaosCap ? 75 : 0);

  // Baseline resistances & attributes from tree + Alira + Purity of Elements + Kitava (-60%)
  const resists = {
    fire: -60 + (arch.bandit === 'Alira' ? 15 : 0),
    cold: -60 + (arch.bandit === 'Alira' ? 15 : 0),
    lightning: -60 + (arch.bandit === 'Alira' ? 15 : 0),
    chaos: -60,
  };
  const attrs = { ...tree.attributes };
  const maxRes = { fire: 75, cold: 75, lightning: 75, chaos: hasCI ? 100 : 75 };
  const dummyAttrs = { str: 0, dex: 0, int: 0 };
  const targetArmourSubType = resolveTargetArmourSubType(arch, tree, skills, rng);
  const wantSuppTarget = (arch.options.targets?.minSuppressPct ?? 0) > 0 || (arch.options.targets?.minDodgePct ?? 0) > 0;
  const isEvasionBuild = (targetArmourSubType.includes('Evasion') || wantSuppTarget) && arch.defenseStyle !== 'es';
  const hasAcrobatics = tree.summary.keystones.includes('Acrobatics');
  const hasMagebane = tree.summary.keystones.includes('Magebane');

  const countSuppressLines = (lines: string[]) => {
    let sum = 0;
    for (const raw of lines) {
      const m = /\+(\d+)% chance to Suppress Spell Damage\b(?! (?:while|if|for))/i.exec(raw);
      if (m) sum += Number(m[1]);
    }
    return sum;
  };

  let currentSuppress = hasMagebane ? Math.floor(attrs.dex / 15) : 0;
  let hasValako = false;
  let hasArmourMaxResMastery = false;
  for (const id of tree.nodes) {
    const n = tree.clusterNodes?.[id] ?? data.tree.nodes[id];
    if (n?.s) {
      tallyModsStats(n.s, resists, dummyAttrs, maxRes);
      currentSuppress += countSuppressLines(n.s);
      if (n.s.some((s) => /Modifiers to Maximum Fire Resistance also apply to Maximum Cold and Lightning Resistances/i.test(s))) {
        hasValako = true;
      }
    }
    if (n?.t === 'mastery' && tree.masteryEffects[id]) {
      const eff = n.me?.find((m) => m.e === tree.masteryEffects[id]);
      if (eff) {
        tallyModsStats(eff.s, resists, dummyAttrs, maxRes);
        currentSuppress += countSuppressLines(eff.s);
        if (isEvasionBuild && eff.s.some((s) => /if Equipped Helmet, Body Armour, Gloves, and Boots all have Evasion Rating/i.test(s))) {
          currentSuppress += 15;
        }
        if (eff.s.some((s) => /if Equipped Helmet, Body Armour, Gloves, and Boots all have Armour/i.test(s))) {
          hasArmourMaxResMastery = true;
        }
      }
    }
  }
  const suppressTarget = hasAcrobatics
    ? Math.max(150, (arch.options.targets?.minDodgePct ?? 0) * 2)
    : Math.max(isEvasionBuild || isHC ? 100 : 0, arch.options.targets?.minSuppressPct ?? 0);
  for (const grp of skills.groups) {
    for (const gi of grp.gems) {
      if (gi.gem.name === 'Purity of Elements') {
        resists.fire += 34; resists.cold += 34; resists.lightning += 34;
      }
      if (gi.gem.name === 'Purity of Fire') maxRes.fire = Math.min(90, maxRes.fire + 4);
      if (gi.gem.name === 'Purity of Ice') maxRes.cold = Math.min(90, maxRes.cold + 4);
      if (gi.gem.name === 'Purity of Lightning') maxRes.lightning = Math.min(90, maxRes.lightning + 4);
    }
  }
  const items: GeneratedItem[] = [];
  const slotMap: Record<string, number> = {};
  const jewelMap: Record<number, number> = {};
  let nextId = 1;

  const reqAttrs = { ...skills.maxReq };
  const overcapMargin = isHC ? 20 : 5;
  const currentNeeds = () => ({
    fire: Math.max(0, maxRes.fire + overcapMargin - resists.fire),
    cold: Math.max(0, maxRes.cold + overcapMargin - resists.cold),
    lightning: Math.max(0, maxRes.lightning + overcapMargin - resists.lightning),
    chaos: Math.max(0, targetChaosRes - resists.chaos),
    str: Math.max(0, reqAttrs.str - attrs.str),
    dex: Math.max(0, reqAttrs.dex - attrs.dex),
    int: Math.max(0, reqAttrs.int - attrs.int),
    suppress: Math.max(0, suppressTarget - currentSuppress),
  });

  // Determine how many uniques to aim for (Trade: 1-3, SSF: 0-2, HC SSF leans toward defensive rares)
  const targetUniques = isTrade
    ? (isHC ? rng.int(2, 3) : rng.int(1, 3))
    : (isHC ? (rng.chance(0.45) ? 1 : 0) : rng.int(0, 2));
  const candidateUniqueSlots: ItemSlotName[] = rng.shuffle(
    isHC
      ? ['Body Armour', 'Weapon 2', 'Helmet', 'Boots', 'Gloves', 'Amulet', 'Belt', 'Ring 1', 'Weapon 1']
      : ['Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Belt'],
  );
  const priorityUniqueSlots: ItemSlotName[] = [];
  if (arch.signatureUnique) priorityUniqueSlots.push('Weapon 1');
  if (isHC && isTrade) {
    const hasHighMaxRes = maxRes.fire > 75 || maxRes.cold > 75 || maxRes.lightning > 75;
    if (hasCI || hasHighMaxRes) {
      priorityUniqueSlots.push('Body Armour');
      if (arch.weaponSetup.includes('shield') && hasHighMaxRes) priorityUniqueSlots.push('Weapon 2');
      if (hasCI && arch.allowedWeaponTypes.includes('Bow')) priorityUniqueSlots.push('Weapon 1');
    }
  }
  const maxUniqueSlots = isHC ? (isTrade ? 3 : 2) : 4;
  const uniqueSlots = new Set<string>(
    [...new Set([...priorityUniqueSlots, ...candidateUniqueSlots])].slice(0, Math.min(maxUniqueSlots, Math.max(targetUniques, priorityUniqueSlots.length))),
  );
  const usedUniqueNames = new Set<string>();
  const effectiveKeystones = new Set<string>(tree.summary.keystones);
  const uniqueCheckOpts = {
    manaReservedPct: skills.manaReservedPct,
    effectiveKeystones,
    isEvasionBuild,
  };

  const slotDefs = getSlotDefsForArchetype(arch);

  // Process uniques first, then armour/jewelry rares (to cover resists/attrs), then weapon/quiver rares for full DPS!
  const isWeaponRareSlot = (d: { slot: ItemSlotName; types: string[] }) =>
    d.slot === 'Weapon 1' || (d.slot === 'Weapon 2' && !d.types.includes('Shield'));
  const rareDefs = slotDefs.filter((d) => !uniqueSlots.has(d.slot));
  const orderedDefs = [
    ...slotDefs.filter((d) => uniqueSlots.has(d.slot)),
    ...rareDefs.filter((d) => !isWeaponRareSlot(d)),
    ...rareDefs.filter((d) => isWeaponRareSlot(d)),
  ];

  for (const def of orderedDefs) {
    const id = nextId++;
    const sockets = skills.slotSockets[def.slot] ?? def.defaultSockets;
    let item: GeneratedItem | undefined;

    if (def.slot === 'Weapon 1' && arch.signatureUnique) {
      const sig = data.uniques.find((u) => u.name === arch.signatureUnique);
      if (sig && data.bases[sig.base]) {
        usedUniqueNames.add(sig.name);
        item = buildUniqueItem(id, def.slot, sig, data.bases[sig.base], sockets, arch, rng);
      }
    }

    if (!item && uniqueSlots.has(def.slot)) {
      const pool = data.uniques
        .filter((u) => !usedUniqueNames.has(u.name) && isUniqueSuitable(u, arch, def.types, data.bases[u.base], targetArmourSubType, uniqueCheckOpts))
        .map((u) => ({ u, score: scoreUniqueForArchetype(u, arch, data.bases[u.base], hasCI, maxRes, uniqueCheckOpts) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, isHC ? 8 : 12);
      if (pool.length > 0) {
        const picked = rng.weighted(pool, (entry) => entry.score * entry.score)?.u;
        if (picked && data.bases[picked.base]) {
          usedUniqueNames.add(picked.name);
          item = buildUniqueItem(id, def.slot, picked, data.bases[picked.base], sockets, arch, rng);
        }
      }
    }

    if (!item) {
      const needs = currentNeeds();
      const [baseName, base] = pickBestBase(data, def.types[0], arch, hasCI, rng, {
        allowedTypes: def.types,
        preferSubType: ARMOUR_SLOTS.has(def.types[0]) ? targetArmourSubType : undefined,
        needs,
        isEvasionBuild,
      });
      item = buildRareItem(id, def.slot, baseName, base, sockets, data, arch, needs, hasCI, maxRes, rng, { isEvasionBuild });
    }

    for (const ks of extractKeystonesFromLines([...item.implicits, ...item.explicits])) {
      effectiveKeystones.add(ks);
    }

    tallyModsStats([...item.implicits, ...item.explicits], resists, attrs, maxRes);
    currentSuppress += countSuppressLines([...item.implicits, ...item.explicits]);
    if (item.base.req.str) reqAttrs.str = Math.max(reqAttrs.str, item.base.req.str);
    if (item.base.req.dex) reqAttrs.dex = Math.max(reqAttrs.dex, item.base.req.dex);
    if (item.base.req.int) reqAttrs.int = Math.max(reqAttrs.int, item.base.req.int);
    items.push(item);
    slotMap[def.slot] = id;
  }

  // Flasks (Flask 1..5)
  const flaskSpecs = getFlaskSpecs(arch, maxRes, isHC, hasCI, isEvasionBuild, wantChaosCap);

  for (const fs of flaskSpecs) {
    const id = nextId++;
    const baseName = rng.pick(fs.bases);
    const base = data.bases[baseName];
    if (base) {
      const flask = buildFlask(id, fs.slot, baseName, base, data, arch, rng);
      items.push(flask);
      slotMap[fs.slot] = id;
    }
  }

  // Jewels for every allocated jewel socket on the passive tree (Cluster Jewels + Base Jewels)
  const clusterBySocket = new Map((tree.clusterJewels ?? []).map((cj) => [cj.socketNodeId, cj]));
  for (const nodeId of tree.jewelSockets) {
    const id = nextId++;
    const cj = clusterBySocket.get(nodeId);
    if (cj) {
      const base = data.bases[cj.baseName];
      if (base) {
        items.push({
          id,
          slot: `Jewel Socket #${nodeId}`,
          name: cj.name,
          baseName: cj.baseName,
          rarity: 'RARE',
          base,
          itemLevel: cj.itemLevel,
          implicits: cj.implicits,
          explicits: cj.explicits,
          prefixes: cj.prefixes,
          suffixes: cj.suffixes,
          rawText: cj.rawText,
          jewelNodeId: nodeId,
        });
        jewelMap[nodeId] = id;
        continue;
      }
    }
    const jewelBaseName = arch.primaryAttr === 'str'
      ? 'Crimson Jewel'
      : arch.primaryAttr === 'dex'
        ? 'Viridian Jewel'
        : 'Cobalt Jewel';
    const base = data.bases[jewelBaseName];
    if (base) {
      const jewel = buildRareItem(
        id,
        `Jewel Socket #${nodeId}`,
        jewelBaseName,
        base,
        undefined,
        data,
        arch,
        currentNeeds(),
        hasCI,
        maxRes,
        rng,
        { isJewel: true, jewelNodeId: nodeId },
      );
      tallyModsStats([...jewel.implicits, ...jewel.explicits], resists, attrs, maxRes);
      items.push(jewel);
      jewelMap[nodeId] = id;
    }
  }

  if (hasArmourMaxResMastery) {
    const allHaveArmour = ['Helmet', 'Body Armour', 'Gloves', 'Boots'].every((slot) => {
      const id = slotMap[slot];
      const it = id ? items.find((x) => x.id === id) : undefined;
      return (it?.base.armour?.ArmourBaseMax ?? 0) > 0;
    });
    if (allHaveArmour) {
      maxRes.fire = Math.min(90, maxRes.fire + 1);
      maxRes.cold = Math.min(90, maxRes.cold + 1);
      maxRes.lightning = Math.min(90, maxRes.lightning + 1);
    }
  }
  if (hasValako) {
    maxRes.cold = Math.min(90, Math.max(maxRes.cold, maxRes.fire));
    maxRes.lightning = Math.min(90, Math.max(maxRes.lightning, maxRes.fire));
  }

  patchGearDeficits(
    data,
    arch,
    items,
    resists,
    attrs,
    maxRes,
    reqAttrs,
    currentSuppress,
    suppressTarget,
    hasCI,
    wantChaosCap,
    isEvasionBuild,
  );

  return { items, slotMap, jewelMap, resists, attributes: attrs, requiredAttributes: reqAttrs };
}

export function rerollGearItem(
  data: GameData,
  arch: BuildArchetype,
  tree: GeneratedTree,
  skills: GeneratedSkills,
  gear: GeneratedGear,
  itemId: number,
  rng: Rng,
  clusterReplacement?: GeneratedItem,
): GeneratedGear {
  const oldItem = gear.items.find((it) => it.id === itemId);
  if (!oldItem) return gear;

  const isTrade = arch.options.economy === 'trade';
  const isHC = arch.options.leagueMode === 'hardcore';
  const hasCI = tree.summary.keystones.includes('Chaos Inoculation');
  const wantChaosCap = isHC || (arch.options.targets?.minChaosMaxHit ?? 0) > 0;
  const targetChaosRes = hasCI ? -999 : (wantChaosCap ? 75 : 0);

  const resists = {
    fire: -60 + (arch.bandit === 'Alira' ? 15 : 0),
    cold: -60 + (arch.bandit === 'Alira' ? 15 : 0),
    lightning: -60 + (arch.bandit === 'Alira' ? 15 : 0),
    chaos: -60,
  };
  const attrs = { ...tree.attributes };
  const maxRes = { fire: 75, cold: 75, lightning: 75, chaos: hasCI ? 100 : 75 };
  const dummyAttrs = { str: 0, dex: 0, int: 0 };

  const countSuppressLines = (lines: string[]) => {
    let sum = 0;
    for (const raw of lines) {
      const m = /\+(\d+)% chance to Suppress Spell Damage\b(?! (?:while|if|for))/i.exec(raw);
      if (m) sum += Number(m[1]);
    }
    return sum;
  };

  const hasAcrobatics = tree.summary.keystones.includes('Acrobatics');
  const hasMagebane = tree.summary.keystones.includes('Magebane');
  const keptArmourSub = gear.items.find(
    (x) => x.id !== itemId && ARMOUR_SLOTS.has(x.base.type) && Boolean(x.base.subType),
  )?.base.subType as ArmourSubType | undefined;
  const targetArmourSubType: ArmourSubType = keptArmourSub ?? resolveTargetArmourSubType(arch, tree, skills, rng);
  const wantSuppTarget = (arch.options.targets?.minSuppressPct ?? 0) > 0 || (arch.options.targets?.minDodgePct ?? 0) > 0;
  const isEvasionBuild = (targetArmourSubType.includes('Evasion') || wantSuppTarget) && arch.defenseStyle !== 'es';

  let currentSuppress = hasMagebane ? Math.floor(attrs.dex / 15) : 0;
  let hasValako = false;
  let hasArmourMaxResMastery = false;
  for (const id of tree.nodes) {
    const n = tree.clusterNodes?.[id] ?? data.tree.nodes[id];
    if (n?.s) {
      tallyModsStats(n.s, resists, dummyAttrs, maxRes);
      currentSuppress += countSuppressLines(n.s);
      if (n.s.some((s) => /Modifiers to Maximum Fire Resistance also apply to Maximum Cold and Lightning Resistances/i.test(s))) {
        hasValako = true;
      }
    }
    if (n?.t === 'mastery' && tree.masteryEffects[id]) {
      const eff = n.me?.find((m) => m.e === tree.masteryEffects[id]);
      if (eff) {
        tallyModsStats(eff.s, resists, dummyAttrs, maxRes);
        currentSuppress += countSuppressLines(eff.s);
        if (isEvasionBuild && eff.s.some((s) => /if Equipped Helmet, Body Armour, Gloves, and Boots all have Evasion Rating/i.test(s))) {
          currentSuppress += 15;
        }
        if (eff.s.some((s) => /if Equipped Helmet, Body Armour, Gloves, and Boots all have Armour/i.test(s))) {
          hasArmourMaxResMastery = true;
        }
      }
    }
  }
  const suppressTarget = hasAcrobatics
    ? Math.max(150, (arch.options.targets?.minDodgePct ?? 0) * 2)
    : Math.max(isEvasionBuild || isHC ? 100 : 0, arch.options.targets?.minSuppressPct ?? 0);

  for (const grp of skills.groups) {
    for (const gi of grp.gems) {
      if (gi.gem.name === 'Purity of Elements') {
        resists.fire += 34; resists.cold += 34; resists.lightning += 34;
      }
      if (gi.gem.name === 'Purity of Fire') maxRes.fire = Math.min(90, maxRes.fire + 4);
      if (gi.gem.name === 'Purity of Ice') maxRes.cold = Math.min(90, maxRes.cold + 4);
      if (gi.gem.name === 'Purity of Lightning') maxRes.lightning = Math.min(90, maxRes.lightning + 4);
    }
  }

  const otherItems = gear.items.filter((it) => it.id !== itemId);
  const reqAttrs = { ...skills.maxReq };
  const otherUniqueNames = new Set<string>();
  const effectiveKeystones = new Set<string>(tree.summary.keystones);
  for (const it of otherItems) {
    if (it.rarity === 'UNIQUE') otherUniqueNames.add(it.name);
    if (it.base.type === 'Flask' || it.base.subType === 'Cluster') continue;
    for (const ks of extractKeystonesFromLines([...it.implicits, ...it.explicits])) {
      effectiveKeystones.add(ks);
    }
    tallyModsStats([...it.implicits, ...it.explicits], resists, attrs, maxRes);
    currentSuppress += countSuppressLines([...it.implicits, ...it.explicits]);
    if (it.base.req.str) reqAttrs.str = Math.max(reqAttrs.str, it.base.req.str);
    if (it.base.req.dex) reqAttrs.dex = Math.max(reqAttrs.dex, it.base.req.dex);
    if (it.base.req.int) reqAttrs.int = Math.max(reqAttrs.int, it.base.req.int);
  }

  const overcapMargin = isHC ? 20 : 5;
  const needs = {
    fire: Math.max(0, maxRes.fire + overcapMargin - resists.fire),
    cold: Math.max(0, maxRes.cold + overcapMargin - resists.cold),
    lightning: Math.max(0, maxRes.lightning + overcapMargin - resists.lightning),
    chaos: Math.max(0, targetChaosRes - resists.chaos),
    str: Math.max(0, reqAttrs.str - attrs.str),
    dex: Math.max(0, reqAttrs.dex - attrs.dex),
    int: Math.max(0, reqAttrs.int - attrs.int),
    suppress: Math.max(0, suppressTarget - currentSuppress),
  };

  let replacement: GeneratedItem | undefined = clusterReplacement;

  if (!replacement && oldItem.base.type === 'Flask') {
    const specs = getFlaskSpecs(arch, maxRes, isHC, hasCI, isEvasionBuild, wantChaosCap);
    const bases = specs.find((s) => s.slot === oldItem.slot)?.bases ?? [oldItem.baseName];
    const altBases = bases.length > 1 ? bases.filter((b) => b !== oldItem.baseName) : bases;
    const baseName = rng.pick(altBases.length > 0 ? altBases : bases);
    const base = data.bases[baseName] ?? oldItem.base;
    replacement = buildFlask(oldItem.id, oldItem.slot, baseName, base, data, arch, rng);
  } else if (!replacement && oldItem.jewelNodeId !== undefined) {
    const jewelBaseName = arch.primaryAttr === 'str'
      ? 'Crimson Jewel'
      : arch.primaryAttr === 'dex'
        ? 'Viridian Jewel'
        : 'Cobalt Jewel';
    const base = data.bases[jewelBaseName] ?? oldItem.base;
    replacement = buildRareItem(
      oldItem.id,
      oldItem.slot,
      jewelBaseName,
      base,
      undefined,
      data,
      arch,
      needs,
      hasCI,
      maxRes,
      rng,
      { isJewel: true, jewelNodeId: oldItem.jewelNodeId },
    );
  } else if (!replacement) {
    const slotDef = getSlotDefsForArchetype(arch).find((d) => d.slot === oldItem.slot);
    const types = slotDef?.types ?? [oldItem.base.type];
    const sockets = oldItem.sockets ?? skills.slotSockets[oldItem.slot] ?? slotDef?.defaultSockets;

    const uniqueCheckOpts = {
      manaReservedPct: skills.manaReservedPct,
      effectiveKeystones,
      isEvasionBuild,
    };
    const uniquePool = data.uniques
      .filter((u) => !otherUniqueNames.has(u.name) && isUniqueSuitable(u, arch, types, data.bases[u.base], targetArmourSubType, uniqueCheckOpts))
      .map((u) => ({ u, score: scoreUniqueForArchetype(u, arch, data.bases[u.base], hasCI, maxRes, uniqueCheckOpts) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, isHC ? 8 : 12);

    const uniqueChance = isTrade ? 0.25 : 0.12;
    const distinctUniques = uniquePool.filter((entry) => entry.u.name !== oldItem.name);
    if (distinctUniques.length > 0 && rng.chance(uniqueChance)) {
      const picked = rng.weighted(distinctUniques, (entry) => entry.score * entry.score)?.u;
      if (picked && data.bases[picked.base]) {
        replacement = buildUniqueItem(oldItem.id, oldItem.slot, picked, data.bases[picked.base], sockets, arch, rng);
      }
    }

    if (!replacement) {
      const [baseName, base] = pickBestBase(data, types[0], arch, hasCI, rng, {
        allowedTypes: types,
        preferSubType: ARMOUR_SLOTS.has(types[0]) ? targetArmourSubType : undefined,
        needs,
        isEvasionBuild,
      });
      replacement = buildRareItem(oldItem.id, oldItem.slot, baseName, base, sockets, data, arch, needs, hasCI, maxRes, rng, { isEvasionBuild });
    }
  }

  if (replacement.base.type !== 'Flask' && replacement.base.subType !== 'Cluster') {
    tallyModsStats([...replacement.implicits, ...replacement.explicits], resists, attrs, maxRes);
    currentSuppress += countSuppressLines([...replacement.implicits, ...replacement.explicits]);
    if (replacement.base.req.str) reqAttrs.str = Math.max(reqAttrs.str, replacement.base.req.str);
    if (replacement.base.req.dex) reqAttrs.dex = Math.max(reqAttrs.dex, replacement.base.req.dex);
    if (replacement.base.req.int) reqAttrs.int = Math.max(reqAttrs.int, replacement.base.req.int);
  }

  const nextItems = gear.items.map((it) => (it.id === itemId ? replacement! : it));
  if (hasArmourMaxResMastery) {
    const allHaveArmour = ['Helmet', 'Body Armour', 'Gloves', 'Boots'].every((slot) => {
      const id = gear.slotMap[slot];
      const it = id ? nextItems.find((x) => x.id === id) : undefined;
      return (it?.base.armour?.ArmourBaseMax ?? 0) > 0;
    });
    if (allHaveArmour) {
      maxRes.fire = Math.min(90, maxRes.fire + 1);
      maxRes.cold = Math.min(90, maxRes.cold + 1);
      maxRes.lightning = Math.min(90, maxRes.lightning + 1);
    }
  }
  if (hasValako) {
    maxRes.cold = Math.min(90, Math.max(maxRes.cold, maxRes.fire));
    maxRes.lightning = Math.min(90, Math.max(maxRes.lightning, maxRes.fire));
  }

  if (replacement.rarity === 'RARE' && replacement.base.type !== 'Flask' && replacement.base.subType !== 'Cluster') {
    patchGearDeficits(
      data,
      arch,
      [replacement],
      resists,
      attrs,
      maxRes,
      reqAttrs,
      currentSuppress,
      suppressTarget,
      hasCI,
      wantChaosCap,
      isEvasionBuild,
    );
  }

  return {
    ...gear,
    items: nextItems,
    resists,
    attributes: attrs,
    requiredAttributes: reqAttrs,
  };
}