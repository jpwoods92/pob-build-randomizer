import type { GameData, GemData } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { Rng } from './rng.ts';

export interface GemInstance {
  gem: GemData;
  level: number;
  quality: number;
  enabled: boolean;
}

export interface SocketGroup {
  label: string;
  slot: string;
  enabled: boolean;
  includeInFullDps: boolean;
  gems: GemInstance[];
}

export interface GeneratedSkills {
  groups: SocketGroup[];
  mainSocketGroupIndex: number;
  slotSockets: Record<string, string>; // e.g. { "Body Armour": "R-R-G-B-B-G" }
  manaReservedPct: number;
  maxReq: { str: number; dex: number; int: number };
}

function evalSkillExpr(expr: string[] | undefined, activeTypes: Set<string>): boolean {
  if (!expr || expr.length === 0) return true;
  const stack: boolean[] = [];
  for (const tok of expr) {
    if (tok === 'OR') {
      const b = stack.pop() ?? false;
      const a = stack.pop() ?? false;
      stack.push(a || b);
    } else if (tok === 'AND') {
      const b = stack.pop() ?? false;
      const a = stack.pop() ?? false;
      stack.push(a && b);
    } else if (tok === 'NOT') {
      const a = stack.pop() ?? false;
      stack.push(!a);
    } else {
      stack.push(activeTypes.has(tok));
    }
  }
  return stack.some(Boolean);
}

export function canSupportSkill(
  support: GemData,
  active: GemData,
  extraAddedTypes: string[] = [],
): boolean {
  if (!support.support) return false;
  const types = new Set([...active.types, ...extraAddedTypes]);
  // Minion skills also expose minionSkillTypes when relevant unless ignoreMinionTypes
  if (!active.ignoreMinionTypes && active.minionTypes) {
    for (const mt of active.minionTypes) types.add(mt);
  }
  const reqOk = !support.require || support.require.length === 0 || evalSkillExpr(support.require, types);
  if (!reqOk) return false;
  if (support.exclude && support.exclude.length > 0 && evalSkillExpr(support.exclude, types)) {
    return false;
  }
  return true;
}

function colorChar(color: number): 'R' | 'G' | 'B' | 'W' {
  if (color === 1) return 'R';
  if (color === 2) return 'G';
  if (color === 3) return 'B';
  return 'W';
}

function scoreSupportForMain(sup: GemData, arch: BuildArchetype): number {
  const name = sup.name;
  // Filter out pure utility/trigger/meme/non-DPS supports
  if (/Cast on|Cast when|Cast While|Spellslinger|Hextouch|Mark On Hit|Generosity|Guardian's Blessing|Meat Shield|Elemental Army|Item Rarity|Mana Leech|Life Leech|Life Gain on Hit|Stun$|Endurance Charge on Melee Stun|Knockback|Blind|Chance to Flee|Block Chance Reduction|Additional Accuracy|Second Wind|Swiftbrand|Arcane Surge|Urgent Orders|Corrupting Cry|Autoexertion|Summon Phantasm|Pacifism|Invert the Rules|Cull the Weak|Hallow|Foulgrasp|Hextoad|Hexpass|Hex Bloom|Blessed Call|Devour|Greater Devour|Crystalfall|Excommunicate|Exemplar|Machinations|Invention|Transfusion|Communion|Companionship|Congregation|Scornful Herald|Manaforged Arrows|Frigid Bond|Flamewood|Overloaded Intensity|Living Lightning|Voidstorm|Void Shockwave|Bonespire|Eclipse|Fissure|Windburst|Kinetic Instability|Greater Kinetic Instability/.test(name)) {
    return 0;
  }
  if (/Lifetap|Culling Strike/.test(name)) {
    return name === 'Lifetap' && arch.options.leagueMode === 'hardcore' ? 14 : 6;
  }
  if (/Trap$|Cluster Traps|Multiple Traps|Trap and Mine|Charged Traps|Advanced Traps/.test(name) && arch.damageStyle !== 'trap_mine') return 0;
  if (/Mine$|High-Impact Mine|Blastchain Mine|Locus Mine|Minefield|Swift Assembly|Charged Mines/.test(name) && arch.damageStyle !== 'trap_mine') return 0;
  if (/Spell Totem|Ballista Totem|Multiple Totems|Focused Ballista|Earthbreaker/.test(name) && arch.damageStyle !== 'totem') return 0;

  let score = 10;
  const isTrade = arch.options.economy === 'trade';
  const isAwakened = sup.tags.includes('awakened');
  const isExceptional = sup.tags.includes('exceptional');

  if (isAwakened && !isTrade) return 0; // No awakened gems in SSF
  if (isExceptional && !isTrade) score *= 0.1;
  if (isAwakened && isTrade) score *= 1.45;

  // Anti-synergies & ailment-specific guards
  if (name.includes('Brutality') && !arch.elements.includes('physical')) return 0;
  if (name.includes('Void Manipulation') && !arch.elements.includes('chaos')) return 0;
  if (name.includes('Added Chaos Damage') && !arch.elements.includes('chaos')) return 0;
  if (name.includes('Added Fire Damage') && !arch.elements.includes('fire') && !arch.elements.includes('physical')) return 0;
  if (name.includes('Added Cold Damage') && !arch.elements.includes('cold')) return 0;
  if (name.includes('Added Lightning Damage') && !arch.elements.includes('lightning')) return 0;
  if ((name.includes('Trinity') || name.includes('Unholy Trinity')) && arch.elements.length < 2) return 0;
  if ((name.includes('Overexertion') || name.includes('Fist of War')) && !arch.mainSkill.tags.includes('slam')) return 0;
  if (name.includes('Energy Leech') && arch.defenseStyle === 'life') return 0;
  if (name.includes('Elemental Focus') && arch.damageStyle === 'dot') return 0;
  if (/Deadly Ailments|Sadism|Rupture|Ignite Proliferation|Chance to Bleed|Bloodlust|Decay|Vile Toxins/.test(name) && arch.damageStyle !== 'dot') return 0;
  if (/Elemental Proliferation|Bonechill|Overcharge|Cold to Fire/.test(name)) score *= 0.2;
  if (name.includes('Cruelty') && arch.damageStyle !== 'dot' && !arch.elements.includes('physical')) return 2;
  if (name.includes('Concentrated Effect') && arch.options.leagueMode === 'hardcore') score *= 0.85;
  if (name.includes('Greater Multiple Projectiles') && arch.damageStyle === 'dot') score *= 0.4;
  if (arch.trapOrMine === 'trap' && /Mine|Minefield/.test(name)) return 0;
  if (arch.trapOrMine === 'mine' && /Trap/.test(name)) return 0;

  // Crit vs non-crit
  if (arch.critMode === 'crit') {
    if (/Increased Critical Strikes|Increased Critical Damage|Power Charge On Critical|Nightblade/.test(name)) score += 45;
  } else {
    if (/Critical/.test(name)) return 0;
    if (name.includes('Controlled Destruction') || name.includes('Elemental Overload')) score += 35;
  }

  // Element matches
  for (const el of arch.elements) {
    if (el === 'fire' && /Fire Penetration|Added Fire|Burning Damage|Combustion|Immolate/.test(name)) score += 38;
    if (el === 'cold' && /Cold Penetration|Added Cold|Hypothermia|Ice Bite/.test(name)) score += 38;
    if (el === 'lightning' && /Lightning Penetration|Added Lightning|Innervate/.test(name)) score += 38;
    if (el === 'chaos' && /Void Manipulation|Added Chaos|Unbound Ailments|Withering Touch/.test(name)) score += 40;
    if (el === 'physical' && /Brutality|Impale|Maim|Melee Physical Damage|Ruthless|Rage|Pulverise|Fist of War/.test(name)) score += 38;
  }
  if (arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning')) {
    if (/Elemental Damage with Attacks|Trinity|Elemental Penetration/.test(name)) score += 42;
  }

  // Style matches
  if (arch.damageStyle === 'minion' && /Minion Damage|Feeding Frenzy|Predator|Multistrike|Melee Physical Damage/.test(name)) score += 48;
  if (arch.damageStyle === 'dot' && /Efficacy|Swift Affliction|Unbound Ailments|Deadly Ailments|Burning Damage|Void Manipulation|Ignite Proliferation|Chance to Bleed/.test(name)) score += 45;
  if (arch.damageStyle === 'attack' && /Multistrike|Melee Physical Damage|Close Combat|Fortify|Mirage Archer|Vicious Projectiles|Faster Attacks|Inspiration|Damage on Full Life|Volatility|Returning Projectiles|Barrage/.test(name)) {
    score += 36;
    if (name === 'Fortify' && arch.options.leagueMode === 'hardcore') score += 25;
  }
  if (arch.damageStyle === 'spell' && /Spell Echo|Unleash|Controlled Destruction|Inspiration|Concentrated Effect|Intensify|Faster Casting|Energy Leech|Spellblade/.test(name)) score += 36;
  if (arch.damageStyle === 'totem' && /Multiple Totems|Spell Totem|Ballista Totem|Focused Ballista/.test(name)) score += 45;
  if (arch.damageStyle === 'trap_mine' && /Trap and Mine Damage|Cluster Traps|Charged Traps|Minefield|High-Impact Mine|Blastchain Mine|Swift Assembly|Charged Mines/.test(name)) score += 45;

  if (name === 'Empower' || name === 'Awakened Empower') {
    score += arch.damageStyle === 'spell' || arch.damageStyle === 'minion' ? 35 : 5;
  }

  return score;
}

export function generateSkills(data: GameData, arch: BuildArchetype, rng: Rng): GeneratedSkills {
  const byName = new Map<string, GemData>();
  for (const g of data.gems) {
    if (!byName.has(g.name)) byName.set(g.name, g);
  }
  const getGem = (name: string): GemData | undefined => byName.get(name);
  const isTrade = arch.options.economy === 'trade';
  const isHC = arch.options.leagueMode === 'hardcore';
  const baseGemLevel = Math.min(20, Math.max(18, arch.options.level - 70));
  const mainLevel = isTrade && rng.chance(0.45) ? 21 : baseGemLevel;
  const gemQual = isTrade ? 20 : rng.pick([0, 14, 20]);

  const groups: SocketGroup[] = [];

  // 1. Main Skill Setup (Body Armour)
  const mainLinks = isTrade ? 6 : (rng.chance(0.65) ? 6 : 5);
  const addedTypes: string[] = [];
  const forcedSupports: GemData[] = [];

  if (arch.damageStyle === 'totem' && !arch.mainSkill.tags.includes('totem')) {
    const totemSup = arch.mainSkill.tags.includes('attack') ? getGem('Ballista Totem') : getGem('Spell Totem');
    if (totemSup && canSupportSkill(totemSup, arch.mainSkill)) {
      forcedSupports.push(totemSup);
      if (totemSup.add) addedTypes.push(...totemSup.add);
    }
  } else if (arch.damageStyle === 'trap_mine' && !arch.mainSkill.tags.includes('trap') && !arch.mainSkill.tags.includes('mine')) {
    const tmSup = arch.trapOrMine === 'mine' ? getGem('High-Impact Mine') : getGem('Trap');
    if (tmSup && canSupportSkill(tmSup, arch.mainSkill)) {
      forcedSupports.push(tmSup);
      if (tmSup.add) addedTypes.push(...tmSup.add);
    }
  }

  const allSupports = data.gems.filter((g) => g.support);
  const compatibleSupports = allSupports.filter(
    (s) => !forcedSupports.some((f) => f.name === s.name) && canSupportSkill(s, arch.mainSkill, addedTypes),
  );

  const chosenSupports: GemData[] = [...forcedSupports];
  const chosenBaseNames = new Set(chosenSupports.map((s) => s.name.replace(/^Awakened /, '')));

  while (chosenSupports.length < mainLinks - 1) {
    const hasBrutality = chosenSupports.some((s) => s.name === 'Brutality');
    const hasEleSup = chosenSupports.some((s) => /Added (Fire|Cold|Lightning)|Elemental|Penetration|Immolate|Combustion|Hypothermia|Ice Bite|Innervate|Cold to Fire|Physical to Lightning|Trinity/.test(s.name));
    const hasMineOverride = chosenSupports.some((s) => /^(High-Impact Mine|Blastchain Mine|Locus Mine)$/.test(s.name));
    const pool = compatibleSupports.filter((s) => {
      const baseName = s.name.replace(/^Awakened /, '');
      if (chosenBaseNames.has(baseName)) return false;
      if (hasMineOverride && /^(High-Impact Mine|Blastchain Mine|Locus Mine)$/.test(s.name)) return false;
      if (hasBrutality && /Added (Fire|Cold|Lightning)|Elemental|Penetration|Immolate|Combustion|Hypothermia|Ice Bite|Innervate|Cold to Fire|Physical to Lightning|Trinity/.test(s.name)) return false;
      if (hasEleSup && s.name === 'Brutality') return false;
      return true;
    });
    if (pool.length === 0) break;
    const picked = rng.weighted(pool, (s) => scoreSupportForMain(s, arch));
    if (!picked) break;
    chosenSupports.push(picked);
    chosenBaseNames.add(picked.name.replace(/^Awakened /, ''));
  }

  groups.push({
    label: `Main Skill (${arch.mainSkill.name})`,
    slot: 'Body Armour',
    enabled: true,
    includeInFullDps: true,
    gems: [
      { gem: arch.mainSkill, level: mainLevel, quality: gemQual, enabled: true },
      ...chosenSupports.map((g) => ({
        gem: g,
        level: g.tags.includes('awakened') ? 5 : (g.tags.includes('exceptional') ? 3 : 20),
        quality: gemQual,
        enabled: true,
      })),
    ],
  });

  // 2. Auras & Reservation (Helmet)
  const auraCandidates: { name: string; w: number }[] = [
    { name: 'Determination', w: isHC ? 30 : 12 },
    { name: 'Grace', w: isHC ? 28 : 14 },
    { name: 'Purity of Elements', w: isHC ? 22 : (arch.options.economy === 'ssf' ? 18 : 6) },
    { name: 'Discipline', w: arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid' ? 28 : 1 },
    { name: 'Tempest Shield', w: arch.weaponSetup.includes('shield') ? 22 : 2 },
    { name: 'Arctic Armour', w: isHC ? 14 : 4 },
    { name: 'Defiance Banner', w: isHC ? 16 : 6 },
    { name: 'Vitality', w: isHC ? 12 : 4 },
    { name: 'Precision', w: arch.critMode === 'crit' || arch.damageStyle === 'attack' ? 18 : 2 },
    { name: 'Clarity', w: arch.damageStyle === 'spell' ? 10 : 2 },
  ];

  if (arch.elements.includes('fire')) auraCandidates.push({ name: 'Anger', w: 18 }, { name: 'Herald of Ash', w: 15 });
  if (arch.elements.includes('cold')) auraCandidates.push({ name: 'Hatred', w: 22 }, { name: 'Herald of Ice', w: 16 });
  if (arch.elements.includes('lightning')) auraCandidates.push({ name: 'Wrath', w: 20 }, { name: 'Herald of Thunder', w: 15 });
  if (arch.elements.includes('physical')) auraCandidates.push({ name: 'Pride', w: 20 }, { name: 'Herald of Purity', w: 14 }, { name: 'War Banner', w: 12 });
  if (arch.elements.includes('chaos')) auraCandidates.push({ name: 'Malevolence', w: 24 }, { name: 'Herald of Agony', w: 10 });
  if (arch.damageStyle === 'spell') auraCandidates.push({ name: 'Zealotry', w: 20 });
  if (arch.damageStyle === 'dot') auraCandidates.push({ name: 'Malevolence', w: 24 });
  if (arch.damageStyle === 'minion') auraCandidates.push({ name: 'Haste', w: 18 }, { name: 'Hatred', w: 16 });
  if (arch.damageStyle === 'trap_mine') auraCandidates.push({ name: 'Summon Skitterbots', w: 24 });

  const chosenAuras: GemData[] = [];
  const usedAuraNames = new Set<string>();
  let reservedPct = 0;
  const maxReserve = 85; // Leave comfortable unreserved mana

  // Guarantee at least one strong defensive aura in Hardcore
  if (isHC) {
    const defAuraName = arch.defenseStyle === 'es'
      ? 'Discipline'
      : (arch.primaryAttr === 'dex' ? 'Grace' : 'Determination');
    const defAura = getGem(defAuraName);
    if (defAura) {
      chosenAuras.push(defAura);
      usedAuraNames.add(defAura.name);
      reservedPct += defAura.reservePct ?? 35;
    }
  }

  for (let tries = 0; tries < 8 && chosenAuras.length < 3; tries++) {
    const pick = rng.weighted(
      auraCandidates.filter((a) => !usedAuraNames.has(a.name)),
      (a) => a.w,
    );
    if (!pick) break;
    const g = getGem(pick.name);
    if (!g) { usedAuraNames.add(pick.name); continue; }
    const cost = g.reservePct ?? (g.reserveFlat ? 10 : 25);
    if (reservedPct + cost <= maxReserve) {
      chosenAuras.push(g);
      usedAuraNames.add(g.name);
      reservedPct += cost;
    } else {
      usedAuraNames.add(pick.name);
    }
  }

  const auraGems: GemInstance[] = chosenAuras.map((g) => ({ gem: g, level: 20, quality: gemQual, enabled: true }));
  if (isTrade && auraGems.length >= 2 && rng.chance(0.55)) {
    const enl = getGem('Enlighten');
    if (enl) {
      auraGems.push({ gem: enl, level: 3, quality: 0, enabled: true });
      reservedPct = Math.round(reservedPct * 0.92);
    }
  }
  groups.push({
    label: 'Auras & Reservation',
    slot: 'Helmet',
    enabled: true,
    includeInFullDps: false,
    gems: auraGems,
  });

  // 3. Guard & Defenses (Gloves)
  const guardName = arch.primaryAttr === 'str'
    ? 'Molten Shell'
    : (arch.defenseStyle === 'es' && arch.primaryAttr === 'int' ? 'Arcane Cloak' : (isHC ? 'Immortal Call' : 'Steelskin'));
  const guardGem = getGem(guardName) ?? getGem('Steelskin');
  const guardTrigger = getGem(rng.chance(0.6) ? 'Cast when Damage Taken' : 'Automation');
  const moreDur = getGem('More Duration');
  const guardGems: GemInstance[] = [];
  if (guardGem) {
    const isCwdt = guardTrigger?.name === 'Cast when Damage Taken';
    guardGems.push({ gem: guardGem, level: isCwdt ? 10 : 20, quality: 20, enabled: true });
    if (guardTrigger) guardGems.push({ gem: guardTrigger, level: isCwdt ? 1 : 20, quality: 0, enabled: true });
    if (moreDur) guardGems.push({ gem: moreDur, level: 20, quality: 20, enabled: true });
  }
  if (arch.damageStyle === 'attack' && !isHC && getGem('Blood Rage')) {
    guardGems.push({ gem: getGem('Blood Rage')!, level: 20, quality: 20, enabled: true });
  }
  if (guardGems.length > 0) {
    groups.push({
      label: 'Guard & Utility',
      slot: 'Gloves',
      enabled: true,
      includeInFullDps: false,
      gems: guardGems,
    });
  }

  // 4. Mobility (Boots)
  const moveGems: GemInstance[] = [];
  let moveName = 'Flame Dash';
  if (arch.weaponSetup === 'bow_quiver') moveName = 'Blink Arrow';
  else if (arch.weaponSetup === 'one_hand_shield' || arch.weaponSetup === 'wand_shield') moveName = 'Shield Charge';
  else if (arch.damageStyle === 'attack' && arch.allowedWeaponTypes.some((w) => w.includes('Axe') || w.includes('Mace') || w.includes('Sword'))) moveName = 'Leap Slam';
  else if (arch.primaryAttr === 'dex') moveName = 'Dash';
  else if (rng.chance(0.4)) moveName = 'Frostblink';

  const moveGem = getGem(moveName) ?? getGem('Flame Dash');
  if (moveGem) {
    moveGems.push({ gem: moveGem, level: 20, quality: 20, enabled: true });
    if (moveGem.tags.includes('attack')) {
      const fa = getGem('Faster Attacks');
      const mom = getGem('Momentum');
      if (fa) moveGems.push({ gem: fa, level: 20, quality: 20, enabled: true });
      if (mom) moveGems.push({ gem: mom, level: 20, quality: 20, enabled: true });
    } else {
      const as = getGem('Arcane Surge');
      if (as) moveGems.push({ gem: as, level: 7, quality: 0, enabled: true });
    }
    groups.push({
      label: 'Movement',
      slot: 'Boots',
      enabled: true,
      includeInFullDps: false,
      gems: moveGems,
    });
  }

  // 5. Curse / Mark / Buff (Weapon 1 or Weapon 2)
  const curseGems: GemInstance[] = [];
  let curseName = 'Elemental Weakness';
  if (arch.elements.includes('chaos')) curseName = 'Despair';
  else if (arch.elements.includes('physical') && arch.elements.length === 1) curseName = 'Vulnerability';
  else if (arch.elements.includes('fire') && arch.elements.length === 1) curseName = 'Flammability';
  else if (arch.elements.includes('cold') && arch.elements.length === 1) curseName = 'Frostbite';
  else if (arch.elements.includes('lightning') && arch.elements.length === 1) curseName = 'Conductivity';

  if (arch.damageStyle === 'attack' && arch.critMode === 'crit' && rng.chance(0.65)) {
    curseName = arch.statKeywords.includes('projectile') ? "Sniper's Mark" : "Assassin's Mark";
  } else if (isHC && rng.chance(0.35)) {
    curseName = rng.chance(0.5) ? 'Enfeeble' : 'Temporal Chains';
  }

  const curseGem = getGem(curseName);
  if (curseGem) {
    curseGems.push({ gem: curseGem, level: 20, quality: 20, enabled: true });
    if (curseGem.tags.includes('mark') && arch.damageStyle === 'attack') {
      const moh = getGem('Mark On Hit');
      if (moh) curseGems.push({ gem: moh, level: 20, quality: 20, enabled: true });
    } else if (arch.damageStyle === 'spell' || arch.damageStyle === 'minion' || arch.damageStyle === 'dot') {
      const ab = getGem('Arcanist Brand');
      if (ab) curseGems.push({ gem: ab, level: 20, quality: 0, enabled: true });
    }
  }
  if (arch.damageStyle === 'minion') {
    const desc = getGem('Desecrate');
    const off = getGem(isHC ? 'Bone Offering' : 'Flesh Offering');
    if (desc) curseGems.push({ gem: desc, level: 20, quality: 0, enabled: true });
    if (off && curseGems.length < 3) curseGems.push({ gem: off, level: 20, quality: 20, enabled: true });
  }
  if (curseGems.length > 0) {
    groups.push({
      label: 'Curse & Utility',
      slot: 'Weapon 1',
      enabled: true,
      includeInFullDps: false,
      gems: curseGems.slice(0, 3),
    });
  }

  // Compute socket strings per slot and max attribute requirements
  const slotSockets: Record<string, string> = {};
  const maxReq = { str: 0, dex: 0, int: 0 };

  for (const grp of groups) {
    const colors = grp.gems.map((gi) => colorChar(gi.gem.color));
    if (grp.slot === 'Body Armour') {
      // Always give Body Armour 6 sockets (with mainLinks linked)
      while (colors.length < 6) colors.push(colorChar(arch.mainSkill.color));
      const linked = colors.slice(0, mainLinks).join('-');
      const unlinked = colors.slice(mainLinks).join(' ');
      slotSockets[grp.slot] = unlinked ? `${linked} ${unlinked}` : linked;
    } else {
      slotSockets[grp.slot] = colors.join('-');
    }

    for (const gi of grp.gems) {
      // Scale attribute requirement with level (approx linear for lvl < 20, 100% at lvl 20)
      const factor = Math.min(1, gi.level / 20);
      const reqScale = 1.55; // PoB / PoE lvl 20 gems peak around ~155 when reqStr=100
      maxReq.str = Math.max(maxReq.str, Math.round((gi.gem.str || 0) * reqScale * factor));
      maxReq.dex = Math.max(maxReq.dex, Math.round((gi.gem.dex || 0) * reqScale * factor));
      maxReq.int = Math.max(maxReq.int, Math.round((gi.gem.int || 0) * reqScale * factor));
    }
  }

  return {
    groups,
    mainSocketGroupIndex: 1,
    slotSockets,
    manaReservedPct: reservedPct,
    maxReq,
  };
}
