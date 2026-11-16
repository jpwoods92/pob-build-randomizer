import type { GameData, TreeData, TreeNode } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { Rng } from './rng.ts';

export interface GeneratedTree {
  classId: number;
  ascendClassId: number;
  nodes: number[];
  ascendancyNodes: number[];
  masteryEffects: Record<number, number>;
  jewelSockets: number[];
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

function scoreStatsText(stats: string[] | undefined, arch: BuildArchetype): number {
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
  if (arch.defenseStyle === 'es' && /maximum life/.test(text) && !/maximum life becomes 1/.test(text)) return -80;

  // Defenses
  if (arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid') {
    if (/maximum life/.test(text)) score += isHC ? 38 : 18;
    if (/life regeneration|regenerate .* life/.test(text)) score += isHC ? 14 : 6;
    if (/life leech/.test(text)) score += 7;
  }
  if (arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid') {
    if (/maximum energy shield/.test(text)) score += isHC ? 34 : 20;
    if (/energy shield recharge|faster start of energy shield/.test(text)) score += isHC ? 12 : 6;
  }
  if (/suppress spell damage/.test(text)) score += isHC ? 24 : 11;
  if (/maximum (all )?(fire|cold|lightning|elemental) resistance/.test(text)) score += isHC ? 26 : 12;
  if (/maximum chaos resistance/.test(text)) score += arch.defenseStyle === 'es' ? -80 : (isHC ? 22 : 10);
  if (/to all elemental resistances|to (fire|cold|lightning) resistance/.test(text)) score += isHC ? 10 : 5;
  if (/chaos resistance/.test(text)) score += arch.defenseStyle === 'es' ? -80 : (isHC ? 16 : 6);
  if (/armour/.test(text) && (arch.primaryAttr === 'str' || isHC)) score += isHC ? 10 : 4;
  if (/evasion/.test(text) && (arch.primaryAttr === 'dex' || isHC)) score += isHC ? 9 : 4;
  if (/chance to block/.test(text) && arch.weaponSetup.includes('shield')) score += isHC ? 15 : 7;
  if (/reservation efficiency/.test(text)) score += isHC ? 20 : 15;
  if (/fortif/.test(text) && arch.damageStyle === 'attack') score += isHC ? 18 : 8;
  if (/recoup/.test(text)) score += isHC ? 12 : 5;
  if (/avoid being (shocked|frozen|chilled|ignited)|elemental ailments/.test(text)) score += isHC ? 13 : 5;
  if (/immune to corrupted blood|cannot be inflicted/.test(text)) score += isHC ? 16 : 7;

  // Offense by damage style
  if (arch.damageStyle === 'attack') {
    if (/attack damage|physical damage with|melee damage|projectile attack|bow damage|with axes|with swords|with maces|with claws|with daggers|with wands/.test(text)) {
      score += isHC ? 14 : 18;
    }
    if (/attack speed/.test(text)) score += isHC ? 10 : 14;
    if (/accuracy/.test(text) && arch.critMode !== 'non_crit') score += 8;
    if (/impale/.test(text) && arch.elements.includes('physical')) score += 12;
  } else if (arch.damageStyle === 'spell') {
    if (/spell damage|elemental damage|chaos damage/.test(text)) score += isHC ? 12 : 17;
    if (/cast speed/.test(text)) score += isHC ? 10 : 14;
    if (/critical strike chance for spells|spell critical/.test(text) && arch.critMode === 'crit') score += 14;
  } else if (arch.damageStyle === 'minion') {
    if (/minion/.test(text)) score += 26;
    if (/minion.*maximum life/.test(text)) score += isHC ? 16 : 8;
    if (/aura/.test(text)) score += 8;
  } else if (arch.damageStyle === 'totem') {
    if (/totem/.test(text)) score += 24;
    if (/spell damage|attack damage|elemental damage/.test(text)) score += 9;
  } else if (arch.damageStyle === 'trap_mine') {
    if (arch.trapOrMine === 'trap' && /\btraps?\b/.test(text)) score += 26;
    if (arch.trapOrMine === 'mine' && /\bmines?\b/.test(text)) score += 26;
    if (/spell damage|elemental damage|area damage|projectile/.test(text)) score += 9;
  } else if (arch.damageStyle === 'dot') {
    if (/damage over time|dot multiplier|ignite|bleed|poison|ailment/.test(text)) score += 22;
  } else if (arch.damageStyle === 'link_support') {
    if (/link skills|effect of non-curse auras|mercenary|light radius|skill effect duration/.test(text)) score += 28;
    if (/aura/.test(text)) score += 12;
  }

  // Crit vs non-crit
  if (arch.critMode === 'crit') {
    if (/critical strike multiplier/.test(text)) score += isHC ? 14 : 21;
    if (/critical strike chance/.test(text)) score += isHC ? 11 : 16;
  } else {
    if (/critical strike/.test(text)) score -= 35;
  }

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

function isKeystoneAllowed(node: TreeNode, arch: BuildArchetype): boolean {
  const name = node.n;
  const isHC = arch.options.leagueMode === 'hardcore';
  switch (name) {
    case 'Chaos Inoculation':
      return arch.defenseStyle === 'es';
    case 'Blood Magic':
      return false; // We use mana reservation auras
    case 'Ancestral Bond':
      return arch.damageStyle === 'totem';
    case 'Minion Instability':
    case 'Necromantic Aegis':
      return arch.damageStyle === 'minion';
    case 'Resolute Technique':
      return arch.damageStyle === 'attack' && arch.critMode === 'non_crit';
    case 'Elemental Overload':
      return arch.critMode === 'non_crit' && arch.elements.some((e) => e === 'fire' || e === 'cold' || e === 'lightning');
    case 'Avatar of Fire':
      return arch.elements.length === 1 && arch.elements[0] === 'fire';
    case 'Pain Attunement':
      return arch.defenseStyle === 'es' && !isHC;
    case 'Eldritch Battery':
      return arch.defenseStyle === 'life';
    case 'Mind Over Matter':
      return arch.defenseStyle === 'life' || arch.defenseStyle === 'hybrid';
    case 'Acrobatics':
      return arch.primaryAttr === 'dex' && arch.defenseStyle === 'life';
    case 'Iron Reflexes':
      return arch.defenseStyle === 'life' && isHC;
    case 'Magebane':
      return arch.defenseStyle === 'life' && isHC;
    case 'Ghost Dance':
    case 'Ghost Reaver':
    case 'Wicked Ward':
    case 'Zealot\'s Oath':
    case 'Divine Shield':
      return arch.defenseStyle === 'es' || arch.defenseStyle === 'hybrid';
    case 'The Agnostic':
      return arch.defenseStyle === 'life';
    case 'Point Blank':
      return arch.statKeywords.includes('projectile') && arch.damageStyle === 'attack';
    case 'Runebinder':
      return arch.statKeywords.includes('brand');
    case 'Perfect Agony':
      return arch.damageStyle === 'dot' && arch.critMode === 'crit';
    case 'Precise Technique':
      return arch.damageStyle === 'attack' && arch.critMode === 'non_crit';
    case 'Crimson Dance':
      return arch.damageStyle === 'dot' && arch.elements.includes('physical');
    case 'Lone Messenger':
    case 'Supreme Ego':
    case 'Veil of the Night':
    case 'Hollow Palm Technique':
      return false; // Restricts gear/auras in ways that conflict with randomized gear/auras
    case 'Glancing Blows':
      return arch.weaponSetup.includes('shield');
    case 'Call to Arms':
      return false;
    case 'Solipsism':
    case 'Voracious Flame':
    case 'Bitter Frost':
    case 'Bloodsoaked Blade':
    case 'Disciple of Kitava':
    case 'Arsenal of Vengeance':
    case 'Roiling Tempest':
    case 'Pitfighter':
    case 'Kineticism':
    case 'Veteran\'s Awareness':
      return !isHC;
    default:
      return true;
  }
}

function scoreNode(id: number, node: TreeNode, arch: BuildArchetype): number {
  if (node.t === 'start' || node.t === 'ascStart' || node.t === 'mastery') return 0;
  let score = scoreStatsText(node.s, arch);
  if (node.t === 'notable') score += 10;
  else if (node.t === 'jewel') {
    score += arch.options.economy === 'trade' ? 34 : 20;
  } else if (node.t === 'keystone') {
    if (!isKeystoneAllowed(node, arch)) return -9999;
    score += node.n === 'Chaos Inoculation' && arch.defenseStyle === 'es' ? 220 : 22;
  }
  // Small bonus for life/ES cluster travel nodes
  if (node.t === 'normal' && score <= 0) score = 0.5;
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

export function generatePassiveTree(data: GameData, arch: BuildArchetype, rng: Rng): GeneratedTree {
  const tree = data.tree;
  const { ascendancyNodes, ascPointsUsed, extraPassivePoints, extraStartClasses } = allocateAscendancy(tree, arch, rng.fork('asc'));

  const banditPoints = arch.bandit === 'None' ? 24 : 22;
  const baseBudget = Math.min(tree.points.totalPoints, Math.max(1, arch.options.level - 1 + banditPoints));
  const pointsBudget = baseBudget + extraPassivePoints;

  const allocated = new Set<number>([arch.classData.start]);
  const masteryEffects: Record<number, number> = {};
  const usedMasteryEffects = new Set<number>();
  let pointsUsed = 0;

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
    nodeScore.set(id, scoreNode(id, node, arch));
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

  // Iteratively expand toward the best efficiency notable / keystone / jewel socket
  while (pointsUsed < pointsBudget) {
    const remaining = pointsBudget - pointsUsed;
    // Dijkstra from all currently allocated main nodes (cost = 1 per unallocated node)
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    // Simple bucketed queue since every step costs 1 (BFS!)
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
      if (d >= remaining || d >= 18) continue; // cap search radius per step for speed
      const cnode = tree.nodes[cur];
      if (!cnode || cnode.t === 'mastery') continue; // can't path THROUGH a mastery
      for (const nxt of cnode.adj) {
        const nn = tree.nodes[nxt];
        if (!nn || nn.a || nn.t === 'start' || nn.t === 'mastery') continue;
        if (nn.t === 'keystone' && !isKeystoneAllowed(nn, arch)) continue;
        if (!dist.has(nxt)) {
          dist.set(nxt, d + 1);
          prev.set(nxt, cur);
          queue.push(nxt);
        }
      }
    }

    // Rank target nodes (notables, keystones, jewel sockets)
    const targets: { id: number; d: number; effScore: number }[] = [];
    for (const [id, d] of dist.entries()) {
      if (d === 0 || d > remaining) continue;
      const nn = tree.nodes[id];
      if (!nn) continue;
      if (nn.t !== 'notable' && nn.t !== 'keystone' && nn.t !== 'jewel') continue;
      const base = nodeScore.get(id) ?? 0;
      if (base <= 2) continue;

      // Also include small bonus for any high-value nodes along the path
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
    const chosen = rng.weighted(topPool, (t) => Math.max(0.1, t.effScore))!;

    // Reconstruct path from chosen.id back to allocated
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
        allocated.add(pid);
        pointsUsed++;
        if (tree.nodes[pid]?.t === 'notable') {
          tryPickMasteryForNotable(pid);
        }
      }
    }
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
        if (nn.t === 'keystone' && !isKeystoneAllowed(nn, arch)) continue;
        frontier.push(nid);
      }
    }
    if (frontier.length === 0) break;
    const pick = rng.weighted(frontier, (id) => Math.max(1, (nodeScore.get(id) ?? 1) + 5))!;
    allocated.add(pick);
    pointsUsed++;
  }

  const mainNodes = [...allocated].filter((id) => id !== arch.classData.start);
  const allNodes = [...new Set([...mainNodes, ...ascendancyNodes])].sort((a, b) => a - b);

  // Tally summary stats
  let str = arch.classData.str;
  let dex = arch.classData.dex;
  let int = arch.classData.int;
  let lifePct = 0;
  let esPct = 0;
  const keystones: string[] = [];
  const notables: string[] = [];
  const masteries: GeneratedTree['summary']['masteries'] = [];
  const jewelSockets: number[] = [];

  for (const id of allNodes) {
    const n = tree.nodes[id];
    if (!n) continue;
    if (n.gs) str += n.gs;
    if (n.gd) dex += n.gd;
    if (n.gi) int += n.gi;
    if (n.t === 'keystone') keystones.push(n.n);
    if (n.t === 'notable' && !n.a) notables.push(n.n);
    if (n.t === 'jewel') jewelSockets.push(id);
    if (n.t === 'mastery' && masteryEffects[id]) {
      const eff = n.me?.find((m) => m.e === masteryEffects[id]);
      if (eff) masteries.push({ nodeId: id, name: n.n, effectId: eff.e, text: eff.s.join(' / ') });
    }
    for (const s of n.s ?? []) {
      const mStr = /\+(\d+) to Strength/.exec(s);
      if (mStr) str += Number(mStr[1]);
      const mDex = /\+(\d+) to Dexterity/.exec(s);
      if (mDex) dex += Number(mDex[1]);
      const mInt = /\+(\d+) to Intelligence/.exec(s);
      if (mInt) int += Number(mInt[1]);
      const mAll = /\+(\d+) to all Attributes/.exec(s);
      if (mAll) {
        const v = Number(mAll[1]);
        str += v; dex += v; int += v;
      }
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
    pointsUsed,
    pointsBudget,
    ascPointsUsed,
    attributes: { str, dex, int },
    summary: { lifePct, esPct, keystones, notables, masteries },
    url,
  };
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
  const masteryBytes: number[] = [];
  let nodeCount = 0;
  let masteryCount = 0;

  const sorted = [...nodeIds].sort((a, b) => a - b);
  for (const id of sorted) {
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
  bytes.push(0); // cluster count
  bytes.push(masteryCount, ...masteryBytes);

  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
  return `https://www.pathofexile.com/passive-skill-tree/${urlVersion}/${b64}`;
}
