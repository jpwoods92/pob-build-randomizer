import type { BaseData, GameData, ModData, UniqueData } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { GeneratedTree } from './tree.ts';
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

function scoreModForArchetype(
  mod: ModData,
  arch: BuildArchetype,
  needs: { fire: number; cold: number; lightning: number; chaos: number; str: number; dex: number; int: number },
  isWeapon: boolean,
): number {
  const txt = mod.lines.join(' ').toLowerCase();
  const isHC = arch.options.leagueMode === 'hardcore';
  const tags = new Set(mod.tags ?? []);
  let w = 1;

  // Penalize very low tiers at endgame
  const tierFactor = mod.lvl >= 68 ? 4.5 : mod.lvl >= 50 ? 2.6 : mod.lvl >= 30 ? 1.4 : 0.7;
  w *= tierFactor;

  if (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid') {
    if (/to maximum life/.test(txt)) w *= isHC ? 22 : 14;
    if (/regenerate .* life/.test(txt)) w *= isHC ? 4 : 1.5;
  } else if (/to maximum life/.test(txt)) {
    w *= 0.05; // CI/ES build doesn't want flat life
  }

  if (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') {
    if (/energy shield/.test(txt)) w *= isHC ? 14 : 10;
  }

  if (/suppress spell damage/.test(txt)) w *= isHC ? 20 : 9;
  if (/movement speed/.test(txt)) w *= 24;

  // Resistances weighted dynamically by current deficit
  if (/fire resistance/.test(txt) && needs.fire > 0) w *= (isHC ? 28 : 22) + needs.fire * 0.25;
  if (/cold resistance/.test(txt) && needs.cold > 0) w *= (isHC ? 28 : 22) + needs.cold * 0.25;
  if (/lightning resistance/.test(txt) && needs.lightning > 0) w *= (isHC ? 28 : 22) + needs.lightning * 0.25;
  if (/all elemental resistances/.test(txt) && (needs.fire > 0 || needs.cold > 0 || needs.lightning > 0)) w *= isHC ? 32 : 24;
  if (/chaos resistance/.test(txt) && needs.chaos > 0) w *= isHC ? 24 : 9;

  // Attributes weighted dynamically by gem/gear deficit
  if (/to strength/.test(txt) && needs.str > 0) w *= 10;
  if (/to dexterity/.test(txt) && needs.dex > 0) w *= 10;
  if (/to intelligence/.test(txt) && needs.int > 0) w *= 10;
  if (/to all attributes/.test(txt) && (needs.str > 0 || needs.dex > 0 || needs.int > 0)) w *= 11;

  // Weapon, jewel & jewelry offensive mods
  if (isWeapon) {
    if (arch.damageStyle === 'attack') {
      if (arch.elements.includes('physical') && /physical damage|attack speed/.test(txt)) w *= 14;
      if (arch.elements.includes('fire') && /fire damage to attacks|elemental damage with attacks|attack speed/.test(txt)) w *= 12;
      if (arch.elements.includes('cold') && /cold damage to attacks|elemental damage with attacks|attack speed/.test(txt)) w *= 12;
      if (arch.elements.includes('lightning') && /lightning damage to attacks|elemental damage with attacks|attack speed/.test(txt)) w *= 12;
      if (arch.elements.includes('chaos') && /chaos damage|attack speed|damage over time/.test(txt)) w *= 10;
      if (/spell damage|to level of all .* spell/.test(txt)) w *= 0.01;
    } else {
      if (/spell damage|cast speed|to level of all/.test(txt)) w *= 14;
      if (arch.damageStyle === 'minion' && /minion/.test(txt)) w *= 22;
      if (arch.damageStyle === 'dot' && /damage over time multiplier/.test(txt)) w *= 18;
      if (arch.elements.includes('fire') && /fire damage|fire skill/.test(txt)) w *= 10;
      if (arch.elements.includes('cold') && /cold damage|cold skill/.test(txt)) w *= 10;
      if (arch.elements.includes('lightning') && /lightning damage|lightning skill/.test(txt)) w *= 10;
      if (arch.elements.includes('chaos') && /chaos damage|chaos skill/.test(txt)) w *= 10;
      if (/physical damage|adds .* to attacks/.test(txt) && !tags.has('caster')) w *= 0.01;
    }
    if (arch.critMode === 'crit' && /critical strike/.test(txt)) w *= 9;
    if (arch.critMode !== 'crit' && /critical strike/.test(txt)) w *= 0.05;
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

    if (arch.damageStyle === 'attack' && /elemental damage with attacks|adds .* to attacks|attack speed/.test(txt)) w *= 6;
    if (arch.damageStyle === 'spell' && /spell damage|cast speed|to level of all/.test(txt)) w *= 7;
    if (arch.damageStyle === 'dot' && /damage over time multiplier/.test(txt)) w *= 12;
    if (arch.critMode === 'crit' && /critical strike multiplier|critical strike chance/.test(txt)) w *= 7;
    if (arch.critMode !== 'crit' && /critical strike/.test(txt)) w *= 0.05;
  }

  // Filter out junk mods like light radius / stun recovery / thorns
  if (/light radius|stun and block recovery|reflects \d+ physical|mana on kill|life on kill/.test(txt)) {
    w *= 0.05;
  }

  return w;
}

function pickBestBase(
  data: GameData,
  slotType: string,
  arch: BuildArchetype,
  rng: Rng,
  opts: { allowedTypes?: string[]; preferSubType?: string; preferTags?: string[] } = {},
): [string, BaseData] {
  const isTrade = arch.options.economy === 'trade';
  const candidates = Object.entries(data.bases).filter(([name, b]) => {
    if (opts.allowedTypes && !opts.allowedTypes.includes(b.type)) return false;
    if (!opts.allowedTypes && b.type !== slotType) return false;
    if (b.subType === 'Talisman') return false;
    if (b.tags.includes('not_for_sale') && b.type !== 'Jewel' && b.type !== 'Flask') return false;
    // Skip ultra-restrictive ritual / heist / scourge oddities in SSF
    if (!isTrade && (b.tags.includes('ritual_base') || /Experimental|Astrolabe|Simplex|Focused|Cogwork|Geodesic|Helical|Kalandra/.test(name))) return false;
    const reqLvl = b.req.level ?? 1;
    if (reqLvl > arch.options.level) return false;
    return true;
  });

  const picked = rng.weighted(candidates, ([name, b]) => {
    const reqLvl = b.req.level ?? 1;
    let w = reqLvl >= 62 ? 12 : reqLvl >= 45 ? 4 : 0.4;
    if (b.tags.includes('top_tier_base_item_type')) w *= 2.5;

    // Match defensive attribute profile on armour pieces
    if (['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield'].includes(b.type)) {
      const wantArmour = arch.primaryAttr === 'str' || arch.options.leagueMode === 'hardcore';
      const wantEvasion = arch.primaryAttr === 'dex';
      const wantES = arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid' || arch.primaryAttr === 'int';
      if (arch.defenseStyle === 'es') {
        if (b.subType === 'Energy Shield') w *= 14;
        else if (b.subType?.includes('Energy Shield')) w *= 4;
        else w *= 0.2;
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
    if (b.type === 'Belt' && name === 'Stygian Vise') w *= isTrade ? 5 : 2;
    if (b.type === 'Belt' && name === 'Leather Belt' && arch.defenseStyle === 'life') w *= 3;
    if (b.type === 'Belt' && name === 'Crystal Belt' && arch.defenseStyle === 'es') w *= 6;
    if (b.type === 'Ring' && /Two-Stone|Amethyst|Vermilion|Opal|Diamond/.test(name)) w *= 3;
    if (b.type === 'Amulet' && /Onyx|Agate|Turquoise|Citrine|Jade|Lapis|Amber/.test(name)) w *= 3;
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

function isUniqueSuitable(u: UniqueData, arch: BuildArchetype, slotTypes: string[]): boolean {
  if (!slotTypes.includes(u.type)) return false;
  if (u.levelReq && u.levelReq > arch.options.level) return false;
  if (arch.options.economy === 'ssf') {
    if (CHASE_OR_BOSS_UNIQUE.test(u.name)) return false;
    if (u.source && /Drops from unique\{|Uber|Pinnacle|Sirus|Maven|Elder|Shaper|Atziri|Cortex|Simulacrum|Heist|Sanctum|Delve|Expedition|Blight/i.test(u.source)) {
      return false;
    }
  }
  if (arch.options.leagueMode === 'hardcore' && HC_RISKY_UNIQUE.test(u.name)) return false;
  if (u.extra?.some((e) => /Limited to:/i.test(e))) return false;
  const fullTxt = [...u.implicits, ...u.explicits].join(' ').toLowerCase();
  if (arch.defenseStyle === 'es' && /cannot have energy shield|blood magic/.test(fullTxt)) return false;
  if (arch.defenseStyle === 'life' && /chaos inoculation|maximum life becomes 1/.test(fullTxt)) return false;
  if (arch.critMode === 'crit' && /never deal critical strikes|critical strikes deal no damage/.test(fullTxt)) return false;
  if (arch.elements.includes('physical') && /deal no physical damage/.test(fullTxt)) return false;
  if (arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning') && /deal no elemental damage/.test(fullTxt)) return false;
  if (arch.elements.includes('chaos') && /deal no chaos damage/.test(fullTxt)) return false;
  if (/cannot use|deal no .* damage/.test(fullTxt) && /deal no (non-)?chaos|deal no elemental/.test(fullTxt)) return false;
  if (/your auras do not affect/.test(fullTxt)) return false;
  return true;
}

function scoreUniqueForArchetype(u: UniqueData, arch: BuildArchetype, base: BaseData | undefined): number {
  const txt = [...u.implicits, ...u.explicits].join(' ').toLowerCase();
  const reqLvl = u.levelReq ?? base?.req.level ?? 1;
  let s = reqLvl >= 50 ? 12 : reqLvl >= 30 ? 5 : 0.6;
  // Leveling weapons without endgame scaling are weak at lvl 90
  if (base?.weapon && reqLvl < 40 && !/spell|minion|gems|aura/i.test(txt)) s *= 0.15;
  if (arch.defenseStyle === 'life' && /maximum life/.test(txt)) s += 8;
  if (arch.defenseStyle === 'es' && /maximum energy shield/.test(txt)) s += 10;
  if (/to all elemental resistances|resistance/.test(txt)) s += arch.options.leagueMode === 'hardcore' ? 11 : 5;
  if (/suppress spell/.test(txt)) s += arch.options.leagueMode === 'hardcore' ? 14 : 6;
  if (arch.damageStyle === 'attack' && /attack|weapon|physical/.test(txt)) s += 8;
  if (arch.damageStyle === 'spell' && /spell|cast speed/.test(txt)) s += 8;
  if (arch.damageStyle === 'minion' && /minion/.test(txt)) s += 18;
  if (arch.damageStyle === 'totem' && /totem/.test(txt)) s += 15;
  if (arch.damageStyle === 'trap_mine' && /trap|mine/.test(txt)) s += 15;
  if (arch.damageStyle === 'dot' && /damage over time|ignite|poison|bleed/.test(txt)) s += 14;
  if (arch.critMode === 'crit' && /critical/.test(txt)) s += 8;
  for (const el of arch.elements) {
    if (txt.includes(el)) s += 6;
  }
  if (/level of all .* gems|movement speed/.test(txt)) s += 9;
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
  let variantNum: number | undefined;
  if (u.variants && u.variants.length > 0) {
    const curIdx = u.variants.findIndex((v) => v === 'Current');
    variantNum = curIdx >= 0 ? curIdx + 1 : u.variants.length;
  }

  const filterVariantLines = (lines: string[]) =>
    lines
      .filter((l) => {
        const vm = /^\{variant:([\d,]+)\}/.exec(l);
        if (!vm || !variantNum) return true;
        return vm[1].split(',').map(Number).includes(variantNum);
      })
      .map((l) => applyRange(l.replace(/\{[^}]+\}/g, ''), roll));

  const implicits = filterVariantLines(u.implicits);
  const explicits = filterVariantLines(u.explicits);

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
  needs: { fire: number; cold: number; lightning: number; chaos: number; str: number; dex: number; int: number },
  rng: Rng,
  opts: { isJewel?: boolean; jewelNodeId?: number } = {},
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
      const archW = scoreModForArchetype(m, arch, needs, isWeapon);
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

  // Reserve 1 slot for a deterministic crafting bench mod when non-jewel so life/res is reliable
  const useBenchCraft = !opts.isJewel;
  const maxEleNeed = Math.max(needs.fire, needs.cold, needs.lightning);
  const benchIsPrefix = maxEleNeed <= 30
    && (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid')
    && !prefixes.some((p) => p.mod.group === 'IncreasedLife');

  const rollPrefixCount = useBenchCraft && benchIsPrefix ? Math.min(maxAffix - 1, targetPrefixes) : targetPrefixes;
  const rollSuffixCount = useBenchCraft && !benchIsPrefix ? Math.min(maxAffix - 1, targetSuffixes) : targetSuffixes;

  for (let i = 0; i < rollPrefixCount; i++) pickAffix('P');
  for (let i = 0; i < rollSuffixCount; i++) pickAffix('S');

  // Crafting bench mod
  let craftedMod: string | undefined;
  if (useBenchCraft) {
    if (benchIsPrefix && prefixes.length < maxAffix && !usedGroups.has('IncreasedLife')) {
      if (['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Ring', 'Amulet', 'Belt'].includes(base.type)) {
        const lifeVal = base.type === 'Body Armour' ? (isTrade ? 95 : 75) : (isTrade ? 70 : 55);
        craftedMod = `+${lifeVal} to maximum Life`;
      }
    }
    if (!craftedMod && suffixes.length < maxAffix) {
      if (needs.fire >= needs.cold && needs.fire >= needs.lightning && needs.fire > 0) {
        craftedMod = isHC ? '+18% to Fire and Chaos Resistances' : '+32% to Fire Resistance';
      } else if (needs.cold >= needs.lightning && needs.cold > 0) {
        craftedMod = isHC ? '+18% to Cold and Chaos Resistances' : '+32% to Cold Resistance';
      } else if (needs.lightning > 0) {
        craftedMod = isHC ? '+18% to Lightning and Chaos Resistances' : '+32% to Lightning Resistance';
      } else if (isHC && (base.type === 'Boots' || base.type === 'Gloves' || base.type === 'Helmet')) {
        craftedMod = '+10% chance to Suppress Spell Damage';
      } else if (isWeapon) {
        craftedMod = arch.damageStyle === 'attack'
          ? (isTrade ? '27% increased Attack Speed' : '18% increased Attack Speed')
          : (isTrade ? '25% increased Cast Speed' : '17% increased Cast Speed');
      }
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
) {
  for (const rawLine of lines) {
    const l = rawLine.replace(/\{[^}]+\}/g, '');
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

export function generateGear(
  data: GameData,
  arch: BuildArchetype,
  tree: GeneratedTree,
  skills: GeneratedSkills,
  rng: Rng,
): GeneratedGear {
  const isTrade = arch.options.economy === 'trade';
  const isHC = arch.options.leagueMode === 'hardcore';
  const targetEleRes = isHC ? 165 : 135; // Accounts for -60% Kitava penalty (135 - 60 = 75%)
  const targetChaosRes = isHC ? 95 : 40;

  // Baseline resistances & attributes from tree + Kitava (-60%)
  const resists = { fire: -60, cold: -60, lightning: -60, chaos: -60 };
  const attrs = { ...tree.attributes };
  const items: GeneratedItem[] = [];
  const slotMap: Record<string, number> = {};
  const jewelMap: Record<number, number> = {};
  let nextId = 1;

  const currentNeeds = () => ({
    fire: Math.max(0, targetEleRes - resists.fire),
    cold: Math.max(0, targetEleRes - resists.cold),
    lightning: Math.max(0, targetEleRes - resists.lightning),
    chaos: Math.max(0, targetChaosRes - resists.chaos),
    str: Math.max(0, skills.maxReq.str - attrs.str),
    dex: Math.max(0, skills.maxReq.dex - attrs.dex),
    int: Math.max(0, skills.maxReq.int - attrs.int),
  });

  // Determine how many uniques to aim for (Trade: 1-3, SSF: 0-2)
  const targetUniques = isTrade ? rng.int(1, 3) : rng.int(0, 2);
  const candidateUniqueSlots: ItemSlotName[] = rng.shuffle([
    'Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Belt',
  ]);
  const uniqueSlots = new Set<string>(candidateUniqueSlots.slice(0, targetUniques));
  if (arch.signatureUnique) uniqueSlots.add('Weapon 1');
  const usedUniqueNames = new Set<string>();

  const slotDefs: { slot: ItemSlotName; types: string[]; defaultSockets?: string }[] = [
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

  // Process uniques first so rare slots can patch remaining resistance/attribute deficits!
  const orderedDefs = [
    ...slotDefs.filter((d) => uniqueSlots.has(d.slot)),
    ...slotDefs.filter((d) => !uniqueSlots.has(d.slot)),
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
      const pool = data.uniques.filter(
        (u) => !usedUniqueNames.has(u.name) && isUniqueSuitable(u, arch, def.types),
      );
      if (pool.length > 0) {
        const picked = rng.weighted(pool, (u) => scoreUniqueForArchetype(u, arch, data.bases[u.base]));
        if (picked && data.bases[picked.base]) {
          usedUniqueNames.add(picked.name);
          item = buildUniqueItem(id, def.slot, picked, data.bases[picked.base], sockets, arch, rng);
        }
      }
    }

    if (!item) {
      const [baseName, base] = pickBestBase(data, def.types[0], arch, rng, { allowedTypes: def.types });
      item = buildRareItem(id, def.slot, baseName, base, sockets, data, arch, currentNeeds(), rng);
    }

    tallyModsStats([...item.implicits, ...item.explicits], resists, attrs);
    items.push(item);
    slotMap[def.slot] = id;
  }

  // Flasks (Flask 1..5)
  const flaskSpecs: { slot: ItemSlotName; bases: string[] }[] = arch.defenseStyle === 'es'
    ? [
        { slot: 'Flask 1', bases: ['Quicksilver Flask'] },
        { slot: 'Flask 2', bases: isHC ? ['Granite Flask', 'Jade Flask'] : ['Diamond Flask', 'Silver Flask'] },
        { slot: 'Flask 3', bases: ['Granite Flask', 'Basalt Flask'] },
        { slot: 'Flask 4', bases: ['Jade Flask', 'Quartz Flask'] },
        { slot: 'Flask 5', bases: ['Amethyst Flask', 'Ruby Flask', 'Sapphire Flask', 'Topaz Flask'] },
      ]
    : [
        { slot: 'Flask 1', bases: ['Divine Life Flask', 'Eternal Life Flask'] },
        { slot: 'Flask 2', bases: ['Quicksilver Flask'] },
        { slot: 'Flask 3', bases: isHC ? ['Granite Flask'] : ['Diamond Flask', 'Granite Flask', 'Silver Flask'] },
        { slot: 'Flask 4', bases: ['Jade Flask', 'Quartz Flask', 'Basalt Flask'] },
        { slot: 'Flask 5', bases: ['Amethyst Flask', 'Silver Flask', 'Ruby Flask', 'Sulphur Flask'] },
      ];

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

  // Jewels for every allocated jewel socket on the passive tree
  for (const nodeId of tree.jewelSockets) {
    const id = nextId++;
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
        rng,
        { isJewel: true, jewelNodeId: nodeId },
      );
      tallyModsStats([...jewel.implicits, ...jewel.explicits], resists, attrs);
      items.push(jewel);
      jewelMap[nodeId] = id;
    }
  }

  return { items, slotMap, jewelMap, resists, attributes: attrs };
}
