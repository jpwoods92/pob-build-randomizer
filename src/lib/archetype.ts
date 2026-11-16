import type { ClassData, AscendancyData, GameData, GemData } from './types.ts';
import type { Rng } from './rng.ts';

export type LeagueMode = 'softcore' | 'hardcore';
export type EconomyMode = 'ssf' | 'trade';
export type DamageStyle = 'attack' | 'spell' | 'minion' | 'totem' | 'trap_mine' | 'dot' | 'link_support';
export type DefenseStyle = 'life' | 'es' | 'hybrid';
export type CritMode = 'crit' | 'non_crit' | 'dot';
export type DamageElement = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos';
export type WeaponSetup = 'bow_quiver' | 'two_hand' | 'one_hand_shield' | 'dual_wield' | 'wand_shield' | 'staff';
export type WeaponClass = 'sword' | 'axe' | 'mace' | 'claw' | 'dagger' | 'sceptre' | 'wand' | 'staff' | 'bow' | 'unarmed';

export interface BuildOptions {
  seed: string;
  leagueMode: LeagueMode;
  economy: EconomyMode;
  classId: number | 'random';
  ascendancyIndex: number | 'random';
  level: number;
  damageStyle: DamageStyle | 'random';
  defenseStyle: DefenseStyle | 'random';
}

export interface BuildArchetype {
  options: BuildOptions;
  classData: ClassData;
  ascendancy: AscendancyData;
  mainSkill: GemData;
  damageStyle: DamageStyle;
  trapOrMine?: 'trap' | 'mine';
  defenseStyle: DefenseStyle;
  critMode: CritMode;
  elements: DamageElement[];
  weaponSetup: WeaponSetup;
  weaponClass: WeaponClass;
  allowedWeaponTypes: string[];
  signatureUnique?: string;
  countsAsAllOneHandMelee: boolean;
  /** Attribute profile used to guide base types and passive node priorities. */
  primaryAttr: 'str' | 'dex' | 'int';
  /** Optional stat-stacking focus when the build intentionally stacks an attribute. */
  statStack?: 'str' | 'dex' | 'int';
  /** Keywords used to score passive nodes, supports, and mods. */
  statKeywords: string[];
  bandit: 'None' | 'Alira' | 'Kraityn' | 'Oak';
  pantheonMajor: string;
  pantheonMinor: string;
  title: string;
}

const EXCLUDED_MAIN_TAGS = new Set([
  'aura', 'herald', 'curse', 'hex', 'mark', 'guard', 'warcry',
  'banner', 'stance', 'blessing', 'link', 'golem', 'blink', 'pact',
]);

// Travel/utility skills that aren't true main DPS skills unless specifically built as such.
const UTILITY_SKILL_NAMES = new Set([
  'Portal', 'Detonate Mines', 'Convocation', 'Desecrate', 'Unearth',
  'Bone Offering', 'Flesh Offering', 'Spirit Offering', 'Blood Rage',
  'Berserk', 'Withering Step', 'Phase Run', 'Smoke Mine', 'Dash',
  'Flame Dash', 'Frostblink', 'Blink Arrow', 'Mirror Arrow', 'Lightning Warp',
  'Shield Charge', 'Whirling Blades', 'Leap Slam', 'Leap Slam of Groundbreaking',
  'Bodyswap', 'Bodyswap of Sacrifice', 'Frostblink of Wintry Blast',
  'Brand Recall', 'Intimidating Cry', 'Enduring Cry', 'Rallying Cry',
  'Seismic Cry', 'Ancestral Cry', 'Infernal Cry', 'General\'s Cry',
  'Battlemage\'s Cry', 'Vengeful Cry', 'Autoexertion', 'Automation',
  'Spellslinger', 'Petrified Blood', 'Righteous Fire', 'Plague Bearer',
  'Tempest Shield', 'Arctic Armour', 'Blood and Sand', 'Flesh and Stone',
  'Defiance Banner', 'Dread Banner', 'War Banner', 'Pride', 'Haste',
  'Grace', 'Determination', 'Discipline', 'Purity of Elements',
  'Purity of Fire', 'Purity of Ice', 'Purity of Lightning', 'Vitality',
  'Clarity', 'Precision', 'Hatred', 'Wrath', 'Anger', 'Zealotry',
  'Malevolence', 'Envy', 'Summon Skitterbots', 'Vaal Breach',
  'Raise Spectre', 'Animate Guardian', 'Summon Holy Relic', 'Summon Carrion Golem',
  'Summon Chaos Golem', 'Summon Flame Golem', 'Summon Ice Golem',
  'Summon Lightning Golem', 'Summon Stone Golem', 'Decoy Totem',
  'Devouring Totem', 'Rejuvenation Totem', 'Searing Bond',
  'Frost Wall', 'Wall of Force', 'Frost Shield', 'Sigil of Power',
  'Hydrosphere', 'Void Sphere', 'Tornado', 'Siphoning Trap',
  'Conversion Trap', 'Wither', 'Ambush', 'Energy Blade',
  'Frozen Legion', 'Frozen Legion of Rallying',
  'Immortal Call', 'Molten Shell', 'Steelskin', 'Arcane Cloak',
  'Vaal Molten Shell', 'Vortex', 'Snipers Mark', 'Cast on Death',
]);

// Class affinity hints per ascendancy internal ID.
interface AscAffinity {
  styles: DamageStyle[];
  defenses: DefenseStyle[];
  elements?: DamageElement[];
  critBias?: number; // 0..1
  hcFriendly?: number;
}

const ASC_AFFINITIES: Record<string, AscAffinity> = {
  Juggernaut: { styles: ['attack', 'totem', 'dot'], defenses: ['life'], elements: ['physical', 'fire'], critBias: 0.25, hcFriendly: 1.8 },
  Berserker: { styles: ['attack'], defenses: ['life'], elements: ['physical', 'fire', 'lightning'], critBias: 0.65, hcFriendly: 0.6 },
  Chieftain: { styles: ['attack', 'totem', 'spell', 'dot'], defenses: ['life'], elements: ['fire', 'physical'], critBias: 0.25, hcFriendly: 1.5 },
  Raider: { styles: ['attack'], defenses: ['life'], elements: ['cold', 'fire', 'lightning'], critBias: 0.75, hcFriendly: 1.0 },
  Deadeye: { styles: ['attack', 'spell'], defenses: ['life'], elements: ['cold', 'lightning', 'fire', 'physical'], critBias: 0.85, hcFriendly: 0.8 },
  Pathfinder: { styles: ['attack', 'dot', 'spell', 'trap_mine'], defenses: ['life'], elements: ['chaos', 'physical', 'cold'], critBias: 0.35, hcFriendly: 1.5 },
  Occultist: { styles: ['spell', 'dot', 'minion'], defenses: ['es', 'life', 'hybrid'], elements: ['chaos', 'cold'], critBias: 0.45, hcFriendly: 1.1 },
  Elementalist: { styles: ['spell', 'dot', 'minion', 'totem'], defenses: ['life', 'es', 'hybrid'], elements: ['fire', 'cold', 'lightning'], critBias: 0.45, hcFriendly: 1.0 },
  Necromancer: { styles: ['minion', 'spell', 'dot'], defenses: ['life', 'es', 'hybrid'], elements: ['physical', 'chaos', 'fire', 'cold', 'lightning'], critBias: 0.2, hcFriendly: 1.4 },
  Slayer: { styles: ['attack'], defenses: ['life'], elements: ['physical', 'cold', 'lightning'], critBias: 0.7, hcFriendly: 1.1 },
  Gladiator: { styles: ['attack', 'dot'], defenses: ['life'], elements: ['physical'], critBias: 0.3, hcFriendly: 1.5 },
  Champion: { styles: ['attack', 'totem', 'minion'], defenses: ['life'], elements: ['physical', 'lightning', 'fire'], critBias: 0.45, hcFriendly: 1.8 },
  Inquisitor: { styles: ['spell', 'attack'], defenses: ['hybrid', 'life', 'es'], elements: ['fire', 'cold', 'lightning'], critBias: 0.9, hcFriendly: 1.3 },
  Hierophant: { styles: ['totem', 'spell'], defenses: ['hybrid', 'es', 'life'], elements: ['lightning', 'cold', 'fire'], critBias: 0.5, hcFriendly: 1.3 },
  Guardian: { styles: ['minion', 'spell', 'attack'], defenses: ['life', 'es', 'hybrid'], elements: ['physical', 'fire', 'lightning'], critBias: 0.25, hcFriendly: 1.6 },
  Assassin: { styles: ['spell', 'attack', 'dot', 'trap_mine'], defenses: ['life', 'es'], elements: ['chaos', 'cold', 'lightning', 'physical'], critBias: 0.95, hcFriendly: 0.65 },
  Trickster: { styles: ['spell', 'dot', 'trap_mine', 'attack'], defenses: ['es', 'hybrid', 'life'], elements: ['chaos', 'lightning', 'cold'], critBias: 0.55, hcFriendly: 1.7 },
  Saboteur: { styles: ['trap_mine', 'spell'], defenses: ['life', 'es', 'hybrid'], elements: ['lightning', 'fire', 'cold', 'chaos'], critBias: 0.7, hcFriendly: 1.2 },
  Ascendant: { styles: ['spell', 'attack', 'minion', 'totem', 'dot'], defenses: ['life', 'hybrid', 'es'], critBias: 0.55, hcFriendly: 1.0 },
  Reliquarian: { styles: ['spell', 'attack', 'totem', 'trap_mine'], defenses: ['life', 'hybrid', 'es'], critBias: 0.5, hcFriendly: 1.0 },
  Luminary: { styles: ['link_support', 'link_support', 'minion', 'spell', 'attack'], defenses: ['life', 'hybrid'], critBias: 0.25, hcFriendly: 1.2 },
};

const BUILD_ADJECTIVES_HC = [
  'Ironclad', 'Bastion', 'Stalwart', 'Unbreakable', 'Sentinel', 'Vigilant',
  'Bulwark', 'Steadfast', 'Resolute', 'Aegis', 'Hardened', 'Indomitable',
];
const BUILD_ADJECTIVES_SC = [
  'Shattering', 'Tempest', 'Ruinous', 'Apex', 'Frenetic', 'Arcane',
  'Volatile', 'Relentless', 'Phantom', 'Cataclysm', 'Blazing', 'Overcharged',
];

function isValidMainCandidate(gem: GemData, allowLink = false): boolean {
  if (gem.support) return false;
  if (gem.reservePct || gem.reserveFlat) return false;
  if (gem.isTrigger) return false;
  if (gem.tags.includes('link')) return allowLink;
  if (gem.tags.some((t) => EXCLUDED_MAIN_TAGS.has(t))) return false;
  if (UTILITY_SKILL_NAMES.has(gem.name) || UTILITY_SKILL_NAMES.has(gem.skillId)) return false;
  if (gem.name.startsWith('Summon ') && gem.tags.includes('golem')) return false;
  if (!gem.types || gem.types.length === 0) return false;
  // Must deal damage or summon combat minions
  const isCombat =
    gem.tags.includes('attack') ||
    gem.tags.includes('spell') ||
    gem.tags.includes('minion') ||
    gem.tags.includes('trap') ||
    gem.tags.includes('mine') ||
    gem.tags.includes('totem');
  if (!isCombat) return false;
  // Must have a real damage calculation or minion creation (excludes buffs/walls/shields/utility)
  const hasDamageCalc =
    gem.types.includes('Attack') ||
    gem.types.includes('Damage') ||
    gem.types.includes('DamageOverTime') ||
    gem.types.includes('CreatesMinion');
  if (!hasDamageCalc) return false;
  // Skip pure movement-tagged skills unless they are iconic attack skills like Flicker Strike / Cyclone
  if (gem.tags.includes('travel') && !['Flicker Strike', 'Consecrated Path', 'Charged Dash'].includes(gem.name)) {
    return false;
  }
  return true;
}

function inferSkillStyle(gem: GemData, preferredStyle: DamageStyle | 'random'): DamageStyle {
  if (gem.tags.includes('link')) return 'link_support';
  if (gem.tags.includes('minion')) return 'minion';
  if (gem.tags.includes('totem')) return 'totem';
  if (gem.tags.includes('trap') || gem.tags.includes('mine')) return 'trap_mine';
  if (preferredStyle === 'totem' && gem.types.includes('Totemable')) return 'totem';
  if (preferredStyle === 'trap_mine' && (gem.types.includes('Trappable') || gem.types.includes('Mineable'))) return 'trap_mine';
  if (preferredStyle === 'dot' && (gem.types.includes('DamageOverTime') || gem.tags.includes('chaos') || gem.tags.includes('fire'))) return 'dot';
  if (gem.tags.includes('attack')) return 'attack';
  if (gem.types.includes('DamageOverTime') && !gem.types.includes('Hit')) return 'dot';
  return 'spell';
}

function inferElements(gem: GemData, aff: AscAffinity, rng: Rng): DamageElement[] {
  const els: DamageElement[] = [];
  if (gem.tags.includes('fire')) els.push('fire');
  if (gem.tags.includes('cold')) els.push('cold');
  if (gem.tags.includes('lightning')) els.push('lightning');
  if (gem.tags.includes('chaos')) els.push('chaos');
  if (gem.tags.includes('physical')) els.push('physical');
  if (els.length === 0) {
    // Physical / generic attack or spell
    if (gem.tags.includes('attack')) {
      els.push('physical');
      if (aff.elements && rng.chance(0.45)) {
        const extra = rng.pick(aff.elements);
        if (!els.includes(extra)) els.push(extra);
      }
    } else {
      els.push(aff.elements ? rng.pick(aff.elements) : 'physical');
    }
  }
  return els;
}

function weaponTypeToClass(wt: string): WeaponClass {
  if (wt === 'Bow') return 'bow';
  if (wt === 'Wand') return 'wand';
  if (wt === 'Sceptre') return 'sceptre';
  if (wt === 'Claw') return 'claw';
  if (wt === 'Dagger' || wt === 'Rune Dagger') return 'dagger';
  if (wt === 'Staff' || wt === 'Warstaff') return 'staff';
  if (wt.includes('Axe')) return 'axe';
  if (wt.includes('Mace')) return 'mace';
  if (wt.includes('Sword')) return 'sword';
  return 'unarmed';
}

function chooseWeaponSetup(
  gem: GemData,
  style: DamageStyle,
  defense: DefenseStyle,
  classData: ClassData,
  league: LeagueMode,
  economy: EconomyMode,
  rng: Rng,
): {
  setup: WeaponSetup;
  weaponClass: WeaponClass;
  allowedWeaponTypes: string[];
  signatureUnique?: string;
  countsAsAllOneHandMelee: boolean;
} {
  const rawWt = (gem.weaponTypes || []).filter((w) => w !== 'None');
  if ((gem.weaponTypes || []).includes('None') && rawWt.length === 0) {
    return {
      setup: 'one_hand_shield',
      weaponClass: 'unarmed',
      allowedWeaponTypes: ['One Handed Sword'],
      countsAsAllOneHandMelee: false,
    };
  }
  if (gem.tags.includes('bow') && rawWt.length === 1 && rawWt[0] === 'Bow') {
    return { setup: 'bow_quiver', weaponClass: 'bow', allowedWeaponTypes: ['Bow'], countsAsAllOneHandMelee: false };
  }

  const classAttrWeight = (wc: WeaponClass): number => {
    if (classData.name === 'Marauder' || classData.name === 'Duelist') {
      if (wc === 'axe' || wc === 'sword' || wc === 'mace') return 3.0;
    } else if (classData.name === 'Ranger' || classData.name === 'Shadow') {
      if (wc === 'bow' || wc === 'claw' || wc === 'dagger' || wc === 'sword' || wc === 'wand') return 3.0;
    } else if (classData.name === 'Templar') {
      if (wc === 'sceptre' || wc === 'mace' || wc === 'staff' || wc === 'wand') return 3.0;
    } else if (classData.name === 'Witch') {
      if (wc === 'wand' || wc === 'dagger' || wc === 'staff' || wc === 'sceptre') return 3.0;
    }
    return 1.0;
  };

  if (rawWt.length > 0) {
    const oneHanded = rawWt.filter((w) =>
      w.startsWith('One Handed') || w.startsWith('Thrusting') || w === 'Claw' || w === 'Dagger' || w === 'Rune Dagger' || w === 'Sceptre' || w === 'Wand',
    );
    const twoHanded = rawWt.filter((w) => w.startsWith('Two Handed') || w === 'Staff' || w === 'Warstaff');
    const options: { setup: WeaponSetup; w: number; types: string[] }[] = [];
    if (oneHanded.length > 0) {
      options.push({ setup: 'one_hand_shield', w: league === 'hardcore' ? 4 : 2.2, types: oneHanded });
      options.push({ setup: 'dual_wield', w: league === 'hardcore' ? 0.5 : 1.8, types: oneHanded });
    }
    if (twoHanded.length > 0) {
      options.push({ setup: 'two_hand', w: league === 'hardcore' ? 1.4 : 2.0, types: twoHanded });
    }
    if (rawWt.includes('Bow')) {
      options.push({ setup: 'bow_quiver', w: 1.8, types: ['Bow'] });
    }
    const picked = rng.weighted(options, (o) => o.w);
    if (picked) {
      // Narrow down to ONE coherent weaponClass within picked.types
      const byClass = new Map<WeaponClass, string[]>();
      for (const t of picked.types) {
        const wc = weaponTypeToClass(t);
        if (!byClass.has(wc)) byClass.set(wc, []);
        byClass.get(wc)!.push(t);
      }
      const chosenClass = rng.weighted([...byClass.keys()], classAttrWeight)!;
      const narrowedTypes = byClass.get(chosenClass)!;
      const canVarunastra = economy === 'trade'
        && chosenClass === 'sword'
        && (picked.setup === 'one_hand_shield' || picked.setup === 'dual_wield')
        && style === 'attack'
        && rng.chance(0.14);
      return {
        setup: picked.setup,
        weaponClass: chosenClass,
        allowedWeaponTypes: narrowedTypes,
        signatureUnique: canVarunastra ? 'Varunastra' : undefined,
        countsAsAllOneHandMelee: canVarunastra,
      };
    }
  }

  // Spell / Minion / Totem / Trap / DoT / Link / Shield-attack caster weapons
  if (style === 'minion' || style === 'spell' || style === 'totem' || style === 'trap_mine' || style === 'dot' || style === 'link_support' || rawWt.length === 0) {
    const esBias = defense === 'es' ? 2.0 : 1.0;
    const hcBias = league === 'hardcore' ? 3.5 : 1.5;
    const casterSetups: { setup: WeaponSetup; w: number; classes: { wc: WeaponClass; types: string[] }[] }[] = [
      {
        setup: 'wand_shield',
        w: hcBias * esBias,
        classes: [
          { wc: 'wand', types: ['Wand'] },
          { wc: 'sceptre', types: ['Sceptre'] },
          { wc: 'dagger', types: ['Dagger'] },
        ],
      },
      {
        setup: 'staff',
        w: league === 'hardcore' ? 1.0 : 1.8,
        classes: [{ wc: 'staff', types: ['Staff'] }],
      },
      {
        setup: 'dual_wield',
        w: league === 'hardcore' ? 0.4 : 1.3,
        classes: [
          { wc: 'wand', types: ['Wand'] },
          { wc: 'sceptre', types: ['Sceptre'] },
          { wc: 'dagger', types: ['Dagger'] },
        ],
      },
    ];
    const picked = rng.weighted(casterSetups, (o) => o.w)!;
    const chosen = rng.weighted(picked.classes, (c) => classAttrWeight(c.wc))!;
    return {
      setup: picked.setup,
      weaponClass: chosen.wc,
      allowedWeaponTypes: chosen.types,
      countsAsAllOneHandMelee: false,
    };
  }

  return {
    setup: 'one_hand_shield',
    weaponClass: 'sword',
    allowedWeaponTypes: ['One Handed Sword'],
    countsAsAllOneHandMelee: false,
  };
}

export function pickArchetype(data: GameData, options: BuildOptions, rng: Rng): BuildArchetype {
  // 1. Class + Ascendancy
  const classes = data.tree.classes;
  let classData: ClassData;
  if (options.classId === 'random') {
    classData = rng.weighted(classes, (c) => {
      if (options.leagueMode === 'hardcore') {
        const avg = c.ascendancies.reduce((s, a) => s + (ASC_AFFINITIES[a.internal]?.hcFriendly ?? 1), 0) / c.ascendancies.length;
        return avg;
      }
      return 1;
    })!;
  } else {
    classData = classes.find((c) => c.id === options.classId) ?? rng.pick(classes);
  }

  let ascendancy: AscendancyData;
  if (options.ascendancyIndex !== 'random' && classData.ascendancies[options.ascendancyIndex - 1]) {
    ascendancy = classData.ascendancies[options.ascendancyIndex - 1];
  } else {
    ascendancy = rng.weighted(classData.ascendancies, (a) => {
      const aff = ASC_AFFINITIES[a.internal];
      if (!aff) return 1;
      let w = options.leagueMode === 'hardcore' ? (aff.hcFriendly ?? 1) : 1;
      if (options.damageStyle !== 'random' && aff.styles.includes(options.damageStyle)) w *= 2.5;
      if (options.defenseStyle !== 'random' && aff.defenses.includes(options.defenseStyle)) w *= 2.0;
      return w;
    })!;
  }

  const aff = ASC_AFFINITIES[ascendancy.internal] ?? {
    styles: ['attack', 'spell'],
    defenses: ['life'],
    critBias: 0.5,
  };

  // 2. Damage style
  const damageStyle: DamageStyle = options.damageStyle !== 'random'
    ? options.damageStyle
    : rng.pick(aff.styles);

  // 3. Defense style
  let defenseStyle: DefenseStyle;
  if (options.defenseStyle !== 'random') {
    defenseStyle = options.defenseStyle;
  } else {
    defenseStyle = rng.weighted(aff.defenses, (d) => {
      if (options.leagueMode === 'hardcore' && d === 'life') return 2.2;
      if (options.economy === 'ssf' && d === 'es') return 0.55; // CI gearing is harder in SSF
      return 1;
    })!;
  }

  // 4. Main active skill
  const allowLink = damageStyle === 'link_support';
  const allCandidates = data.gems.filter((g) => isValidMainCandidate(g, allowLink));
  const mainSkill = rng.weighted(allCandidates, (g) => {
    let w = 1;
    // Transfigured gems are harder to obtain in SSF (still possible via Lab, lower weight)
    const isTransfigured = g.name.includes(' of ');
    if (isTransfigured && options.economy === 'ssf') w *= 0.25;

    // Style match
    const gStyle = inferSkillStyle(g, damageStyle);
    if (gStyle === damageStyle) w *= (allowLink ? 50 : 8);
    else w *= 0.05;

    // Class attribute alignment
    const classStr = classData.str > classData.dex && classData.str > classData.int;
    const classDex = classData.dex > classData.str && classData.dex > classData.int;
    const classInt = classData.int > classData.str && classData.int > classData.dex;
    if (classStr && g.tags.includes('strength')) w *= 2.4;
    if (classDex && g.tags.includes('dexterity')) w *= 2.4;
    if (classInt && g.tags.includes('intelligence')) w *= 2.4;

    // Element affinity
    if (aff.elements && aff.elements.some((e) => g.tags.includes(e))) w *= 2.2;

    // Special iconic synergies
    if (ascendancy.internal === 'Hierophant' && (g.tags.includes('totem') || g.types.includes('Totemable'))) w *= 2.5;
    if (ascendancy.internal === 'Saboteur' && (g.tags.includes('trap') || g.tags.includes('mine') || g.types.includes('Trappable') || g.types.includes('Mineable'))) w *= 2.5;
    if (ascendancy.internal === 'Necromancer' && g.tags.includes('minion')) w *= 3.0;
    if (ascendancy.internal === 'Deadeye' && g.tags.includes('projectile')) w *= 2.5;
    if (ascendancy.internal === 'Pathfinder' && (g.tags.includes('chaos') || g.tags.includes('physical'))) w *= 2.0;

    return w;
  })!;

  const resolvedStyle = inferSkillStyle(mainSkill, damageStyle);
  let trapOrMine: 'trap' | 'mine' | undefined;
  if (resolvedStyle === 'trap_mine') {
    if (mainSkill.tags.includes('mine') && !mainSkill.tags.includes('trap')) trapOrMine = 'mine';
    else if (mainSkill.tags.includes('trap') && !mainSkill.tags.includes('mine')) trapOrMine = 'trap';
    else trapOrMine = rng.chance(0.5) ? 'trap' : 'mine';
  }
  const elements = inferElements(mainSkill, aff, rng);

  // 5. Crit mode
  let critMode: CritMode;
  if (resolvedStyle === 'dot') {
    critMode = rng.chance(0.15) ? 'crit' : 'dot';
  } else if (resolvedStyle === 'minion' || resolvedStyle === 'link_support') {
    critMode = 'non_crit';
  } else {
    const bias = aff.critBias ?? 0.5;
    const critChance = options.leagueMode === 'hardcore' ? bias * 0.78 : bias;
    critMode = rng.chance(critChance) ? 'crit' : 'non_crit';
  }

  // 6. Weapon setup
  const weaponInfo = chooseWeaponSetup(
    mainSkill, resolvedStyle, defenseStyle, classData, options.leagueMode, options.economy, rng,
  );

  // 7. Primary attribute
  let primaryAttr: 'str' | 'dex' | 'int' = 'str';
  if (classData.dex >= classData.str && classData.dex >= classData.int) primaryAttr = 'dex';
  else if (classData.int >= classData.str && classData.int >= classData.dex) primaryAttr = 'int';
  if (defenseStyle === 'es') primaryAttr = 'int';

  // 8. Stat keywords for scoring tree nodes & mods
  const keywords = new Set<string>([resolvedStyle, defenseStyle, ...elements, critMode, weaponInfo.weaponClass]);
  if (trapOrMine) keywords.add(trapOrMine);
  if (weaponInfo.setup === 'bow_quiver') keywords.add('bow');
  if (weaponInfo.setup === 'one_hand_shield' || weaponInfo.setup === 'wand_shield') keywords.add('shield');
  if (weaponInfo.setup === 'two_hand' || weaponInfo.setup === 'staff') keywords.add('twohand');
  if (weaponInfo.setup === 'dual_wield') keywords.add('dualwield');
  if (mainSkill.tags.includes('projectile')) keywords.add('projectile');
  if (mainSkill.tags.includes('area')) keywords.add('area');
  if (mainSkill.tags.includes('melee')) keywords.add('melee');
  if (mainSkill.tags.includes('slam')) keywords.add('slam');
  if (mainSkill.tags.includes('strike')) keywords.add('strike');
  if (mainSkill.tags.includes('brand')) keywords.add('brand');
  if (mainSkill.tags.includes('channelling')) keywords.add('channelling');

  // 9. Bandit & Pantheon
  let bandit: BuildArchetype['bandit'] = 'None';
  if (critMode === 'crit' && options.leagueMode === 'softcore' && rng.chance(0.35)) bandit = 'Alira';
  else if (options.leagueMode === 'hardcore' && defenseStyle === 'life' && rng.chance(0.25)) bandit = 'Oak';

  const hcMajors = ['TheBrineKing', 'Lunaris', 'Solaris', 'Arakaali'];
  const scMajors = ['Solaris', 'Lunaris', 'TheBrineKing', 'Arakaali'];
  const pantheonMajor = rng.pick(options.leagueMode === 'hardcore' ? hcMajors : scMajors);
  const pantheonMinor = rng.pick(data.pantheons.minor).id;

  const adjList = options.leagueMode === 'hardcore' ? BUILD_ADJECTIVES_HC : BUILD_ADJECTIVES_SC;
  const title = `${rng.pick(adjList)} ${mainSkill.name} ${ascendancy.name}`;

  return {
    options,
    classData,
    ascendancy,
    mainSkill,
    damageStyle: resolvedStyle,
    trapOrMine,
    defenseStyle,
    critMode,
    elements,
    weaponSetup: weaponInfo.setup,
    weaponClass: weaponInfo.weaponClass,
    allowedWeaponTypes: weaponInfo.allowedWeaponTypes,
    signatureUnique: weaponInfo.signatureUnique,
    countsAsAllOneHandMelee: weaponInfo.countsAsAllOneHandMelee,
    primaryAttr,
    statKeywords: [...keywords],
    bandit,
    pantheonMajor,
    pantheonMinor,
    title,
  };
}
