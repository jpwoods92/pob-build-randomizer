import type { ClusterSkillDef, GameData, ModData, TreeNode } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { Rng } from './rng.ts';
import { applyRange } from './items.ts';

export interface GeneratedClusterJewel {
  socketNodeId: number;
  baseName: 'Large Cluster Jewel' | 'Medium Cluster Jewel' | 'Small Cluster Jewel';
  name: string;
  itemLevel: number;
  skillId: string;
  skillName: string;
  nodeCount: number;
  socketCount: number;
  implicits: string[];
  explicits: string[];
  prefixes: { mod: ModData; range: number; resolvedLines: string[] }[];
  suffixes: { mod: ModData; range: number; resolvedLines: string[] }[];
  rawText: string;
  allocatedNodeIds: number[];
}

export interface ClusterAllocationResult {
  clusterNodes: Record<number, TreeNode>;
  allocatedNodeIds: number[];
  jewelSockets: number[];
  clusterJewels: GeneratedClusterJewel[];
  pointsSpent: number;
}

const CLUSTER_NAME_FIRST = [
  'Bramble', 'Chimeric', 'Damnation', 'Entropy', 'Foe', 'Ghoul', 'Gloom', 'Grim',
  'Hypnotic', 'Kraken', 'Loath', 'Maelstrom', 'Mind', 'Miracle', 'Oblivion',
  'Pandemonium', 'Phoenix', 'Rift', 'Rune', 'Sorrow', 'Soul', 'Spirit', 'Tempest',
  'Viper', 'Vortex',
];

const CLUSTER_NAME_SECOND = [
  'Bead', 'Blast', 'Bliss', 'Blight', 'Eye', 'Glimmer', 'Gyre', 'Heart',
  'Lustre', 'Prism', 'Shard', 'Spark', 'Star', 'Talisman', 'Turn', 'Twirl',
];

function translateClusterOrbitIndex(srcOidx: number, srcCount: number, destCount: number): number {
  if (srcCount === destCount) return srcOidx;
  if (srcCount === 12 && destCount === 16) {
    return [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15][srcOidx] ?? 0;
  }
  if (srcCount === 16 && destCount === 12) {
    return [0, 1, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 10, 11][srcOidx] ?? 0;
  }
  if (srcCount === 6 && destCount === 16) {
    return [0, 3, 5, 8, 11, 13][srcOidx] ?? 0;
  }
  if (srcCount === 16 && destCount === 6) {
    return [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5][srcOidx] ?? 0;
  }
  return Math.floor((srcOidx * destCount) / srcCount);
}

function orbitAngleRad(count: number, oidx: number): number {
  let deg: number;
  if (count === 16) {
    deg = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330][oidx] ?? (360 * oidx) / count;
  } else {
    deg = (360 * oidx) / count;
  }
  return (deg * Math.PI) / 180;
}

function modWeightForTag(mod: ModData, tags: Set<string>): number {
  for (let i = 0; i < mod.wk.length; i++) {
    if (tags.has(mod.wk[i])) return mod.wv[i] ?? 0;
  }
  return 0;
}

function buildClusterRawText(
  name: string,
  baseName: 'Large Cluster Jewel' | 'Medium Cluster Jewel' | 'Small Cluster Jewel',
  itemLevel: number,
  skillId: string,
  nodeCount: number,
  implicits: string[],
  prefixes: { mod: ModData; range: number }[],
  suffixes: { mod: ModData; range: number }[],
): string {
  const lines = [
    'Rarity: RARE',
    name,
    baseName,
    'Crafted: true',
    ...prefixes.map((p) => `Prefix: {range:${p.range.toFixed(3)}}${p.mod.id}`),
    ...suffixes.map((s) => `Suffix: {range:${s.range.toFixed(3)}}${s.mod.id}`),
    `Item Level: ${itemLevel}`,
    `Cluster Jewel Skill: ${skillId}`,
    `Cluster Jewel Node Count: ${nodeCount}`,
    `Implicits: ${implicits.length}`,
    ...implicits.map((l) => `{crafted}${l}`),
  ];
  return lines.join('\n');
}

interface SubgraphBuildOutput {
  idBase: number;
  nodes: Record<number, TreeNode>;
  entranceId: number;
  notableIds: number[];
  socketIds: number[];
}

export function buildClusterSubgraph(
  data: GameData,
  baseName: 'Large Cluster Jewel' | 'Medium Cluster Jewel' | 'Small Cluster Jewel',
  skill: ClusterSkillDef,
  nodeCount: number,
  socketCount: number,
  notableNames: string[],
  addedSmallLines: string[],
  parentSocketId: number,
  parentIdBits = 0x10000,
): SubgraphBuildOutput | null {
  const jewelDef = data.clusters.jewels[baseName];
  const parentSocket = data.clusters.sockets[String(parentSocketId)];
  if (!jewelDef || !parentSocket) return null;

  let idBase = parentIdBits;
  if (parentSocket.size === 2) {
    idBase += parentSocket.index << 6;
  } else if (parentSocket.size === 1) {
    idBase += parentSocket.index << 9;
  }
  const nodeIdBase = idBase + (jewelDef.sizeIndex << 4);

  const indicies: Record<
    number,
    { id: number; t: TreeNode['t']; n: string; s: string[]; isSocket?: boolean }
  > = {};
  const socketIds: number[] = [];
  const notableIds: number[] = [];

  const childSockets = Object.values(data.clusters.sockets).filter((s) => s.parent === parentSocketId);

  // Pass 1: Sockets
  if (jewelDef.size === 'Large' && socketCount === 1) {
    const child = childSockets.find((s) => s.index === 1) ?? childSockets[0];
    if (child) {
      indicies[6] = { id: child.id, t: 'jewel', n: 'Jewel Socket', s: [], isSocket: true };
      socketIds.push(child.id);
    }
  } else {
    const getJewels = [0, 2, 1];
    for (let i = 0; i < socketCount && i < jewelDef.socketIndicies.length; i++) {
      const idx = jewelDef.socketIndicies[i];
      const child = childSockets.find((s) => s.index === getJewels[i]);
      if (child) {
        indicies[idx] = { id: child.id, t: 'jewel', n: 'Jewel Socket', s: [], isSocket: true };
        socketIds.push(child.id);
      }
    }
  }

  // Pass 2: Notables sorted by PoB notableSortOrder
  const sortOrder = data.clusters.notableSortOrder;
  const sortedNotables = [...notableNames].sort(
    (a, b) => (sortOrder[a] ?? 999999) - (sortOrder[b] ?? 999999),
  );
  const availNotableIndices = jewelDef.notableIndicies.filter((idx) => !indicies[idx]);
  for (let i = 0; i < sortedNotables.length && i < availNotableIndices.length; i++) {
    const name = sortedNotables[i];
    const tmpl = data.clusters.clusterNodes[name];
    if (!tmpl) continue;
    const rawIdx = availNotableIndices[i];
    const id = nodeIdBase + rawIdx;
    indicies[rawIdx] = {
      id,
      t: tmpl.ks ? 'keystone' : 'notable',
      n: tmpl.n,
      s: [...tmpl.s],
    };
    notableIds.push(id);
  }

  // Pass 3: Small passive fill
  const actualNotableCount = notableIds.length;
  const actualSocketCount = socketIds.length;
  const smallCount = Math.max(0, nodeCount - actualSocketCount - actualNotableCount);
  const smallIndexList: number[] = [];
  for (let rawIdx of jewelDef.smallIndicies) {
    if (smallIndexList.length >= smallCount) break;
    if (jewelDef.size === 'Medium') {
      if (nodeCount === 5 && rawIdx === 4) rawIdx = 3;
      else if (nodeCount === 4) {
        if (rawIdx === 8) rawIdx = 9;
        else if (rawIdx === 4) rawIdx = 3;
      }
    }
    if (!indicies[rawIdx]) smallIndexList.push(rawIdx);
  }
  for (const rawIdx of smallIndexList) {
    const id = nodeIdBase + rawIdx;
    indicies[rawIdx] = {
      id,
      t: 'normal',
      n: skill.name,
      s: [...skill.stats, ...addedSmallLines],
    };
  }

  const entranceEntry = indicies[0];
  if (!entranceEntry) return null;

  const orbit = jewelDef.sizeIndex + 1;
  const skillsPerOrbit = data.clusters.constants.skillsPerOrbit[orbit] ?? 16;
  const radius = data.clusters.constants.orbitRadii[orbit] ?? 162;
  const startOidx = data.clusters.orbitOffsets[String(parentSocket.proxy)]?.[String(jewelDef.sizeIndex)] ?? 0;

  const nodes: Record<number, TreeNode> = {};
  const orderedEntries: { rawIdx: number; id: number }[] = [];

  for (let rawIdx = 0; rawIdx < jewelDef.totalIndicies; rawIdx++) {
    const entry = indicies[rawIdx];
    if (!entry) continue;
    const corrected = (rawIdx + startOidx) % jewelDef.totalIndicies;
    const oidx = translateClusterOrbitIndex(corrected, jewelDef.totalIndicies, skillsPerOrbit);
    const angle = orbitAngleRad(skillsPerOrbit, oidx);
    nodes[entry.id] = {
      n: entry.n,
      t: entry.t,
      x: Math.round(parentSocket.px + Math.sin(angle) * radius),
      y: Math.round(parentSocket.py - Math.cos(angle) * radius),
      adj: [],
      ...(entry.s.length > 0 ? { s: entry.s } : {}),
    };
    orderedEntries.push({ rawIdx, id: entry.id });
  }

  for (let i = 1; i < orderedEntries.length; i++) {
    const a = orderedEntries[i - 1].id;
    const b = orderedEntries[i].id;
    nodes[a].adj.push(b);
    nodes[b].adj.push(a);
  }
  if (orderedEntries.length > 1 && jewelDef.size !== 'Small') {
    const first = orderedEntries[0].id;
    const last = orderedEntries[orderedEntries.length - 1].id;
    nodes[first].adj.push(last);
    nodes[last].adj.push(first);
  }

  // Link entrance cleanly to parent socket (parentSocket in main/cluster nodes gets entranceId added by caller if drawn)
  nodes[entranceEntry.id].adj.push(parentSocketId);

  return {
    idBase,
    nodes,
    entranceId: entranceEntry.id,
    notableIds,
    socketIds,
  };
}

function rollOneClusterJewel(
  data: GameData,
  arch: BuildArchetype,
  rng: Rng,
  scoreStats: (stats?: string[]) => number,
  baseName: 'Large Cluster Jewel' | 'Medium Cluster Jewel' | 'Small Cluster Jewel',
  parentSocketId: number,
  parentIdBits: number,
  wantSockets: number,
): { jewel: GeneratedClusterJewel; subgraph: SubgraphBuildOutput } | null {
  const jewelDef = data.clusters.jewels[baseName];
  if (!jewelDef) return null;

  // Score skills using real clusterNodes notable stats!
  const candidates: { skillId: string; skill: ClusterSkillDef; score: number }[] = [];
  for (const [skillId, skill] of Object.entries(jewelDef.skills)) {
    const smallScore = scoreStats(skill.stats);
    const tagSet = new Set([skill.tag]);
    const notableScores: number[] = [];
    for (const m of data.clusters.mods) {
      if (m.affix !== 'Notable') continue;
      if (modWeightForTag(m, tagSet) <= 0) continue;
      const notableName = /1 Added Passive Skill is (.+)$/i.exec(m.lines[0] ?? '')?.[1];
      const tmpl = notableName ? data.clusters.clusterNodes[notableName] : undefined;
      if (!tmpl) continue;
      notableScores.push(scoreStats([tmpl.n, ...tmpl.s]));
    }
    if (notableScores.length === 0) continue;
    notableScores.sort((a, b) => b - a);
    const topNotablesSum = notableScores.slice(0, baseName === 'Large Cluster Jewel' ? 3 : baseName === 'Medium Cluster Jewel' ? 2 : 1)
      .reduce((acc, v) => acc + v, 0);
    let score = smallScore * 1.8 + topNotablesSum;

    const sText = `${skill.name} ${skill.stats.join(' ')}`.toLowerCase();
    if (arch.damageStyle === 'minion' && /minion/.test(sText)) score += 70;
    else if (arch.damageStyle !== 'minion' && /minion/.test(sText)) score -= 300;
    if (arch.damageStyle === 'dot' && /damage over time|burning/.test(sText)) score += 45;
    else if (arch.damageStyle !== 'dot' && /damage over time|burning/.test(sText)) score -= 120;
    if (arch.damageStyle === 'trap_mine' && /trap|mine/.test(sText)) score += 55;
    if (arch.damageStyle === 'totem' && /totem/.test(sText)) score += 55;
    if (baseName === 'Small Cluster Jewel') {
      if (arch.defenseStyle === 'life' && /maximum life/.test(sText)) score += 60;
      if (arch.defenseStyle === 'es' && /energy shield/.test(sText)) score += 60;
      if ((arch.options.targets?.minChaosMaxHit ?? 0) > 0 && /chaos resistance/.test(sText)) score += 55;
      if ((arch.options.targets?.minSuppressPct ?? 0) > 0 && /suppress/.test(sText)) score += 70;
      if (((arch.options.targets?.minAttackBlockPct ?? 0) > 0 || (arch.options.targets?.minSpellBlockPct ?? 0) > 0) && /block/.test(sText)) {
        score += 70;
      }
      if ((arch.options.targets?.minArmour ?? 0) > 0 && /armour/.test(sText)) score += 55;
      if (((arch.options.targets?.minEvasion ?? 0) > 0 || (arch.options.targets?.minEvadePct ?? 0) > 0) && /evasion/.test(sText)) {
        score += 55;
      }
    }
    if (score > 5) candidates.push({ skillId, skill, score });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const chosenSkill = rng.weighted(candidates.slice(0, Math.min(3, candidates.length)), (c) => Math.max(1, c.score)) ?? candidates[0];

  const isTrade = arch.options.economy === 'trade';
  const itemLevel = Math.min(84, Math.max(68, arch.options.level));
  const sizeTag = baseName === 'Large Cluster Jewel'
    ? 'expansion_jewel_large'
    : baseName === 'Medium Cluster Jewel'
      ? 'expansion_jewel_medium'
      : 'expansion_jewel_small';
  const skillTags = new Set([chosenSkill.skill.tag]);
  const smallTags = new Set([sizeTag]);

  // Roll notables (max 2 Prefix + max 1 Suffix on Large, max 1 Prefix + max 1 Suffix on Medium, max 1 Prefix on Small)
  const notableCandidates = data.clusters.mods
    .filter((m) => {
      if (m.affix !== 'Notable' || m.lvl > itemLevel) return false;
      if (modWeightForTag(m, skillTags) <= 0) return false;
      const notableName = /1 Added Passive Skill is (.+)$/i.exec(m.lines[0] ?? '')?.[1];
      return Boolean(notableName && data.clusters.clusterNodes[notableName]);
    })
    .map((m) => {
      const notableName = /1 Added Passive Skill is (.+)$/i.exec(m.lines[0] ?? '')![1];
      const tmpl = data.clusters.clusterNodes[notableName]!;
      return { mod: m, notableName, score: Math.max(1, scoreStats([tmpl.n, ...tmpl.s]) + 25) };
    })
    .sort((a, b) => b.score - a.score);

  const prefixes: { mod: ModData; range: number; resolvedLines: string[] }[] = [];
  const suffixes: { mod: ModData; range: number; resolvedLines: string[] }[] = [];
  const usedGroups = new Set<string>();
  const notableNames: string[] = [];

  const maxPreNotables = baseName === 'Large Cluster Jewel' ? (isTrade ? 2 : rng.pick([1, 2])) : 1;
  const maxSufNotables = baseName === 'Small Cluster Jewel' ? 0 : 1;

  for (const nc of notableCandidates) {
    if (usedGroups.has(nc.mod.group)) continue;
    if (nc.mod.t === 'P' && prefixes.length < maxPreNotables) {
      const range = isTrade ? 0.85 : 0.7;
      prefixes.push({ mod: nc.mod, range, resolvedLines: nc.mod.lines.map((l) => applyRange(l, range)) });
      usedGroups.add(nc.mod.group);
      notableNames.push(nc.notableName);
    } else if (nc.mod.t === 'S' && suffixes.length < maxSufNotables) {
      const range = isTrade ? 0.85 : 0.7;
      suffixes.push({ mod: nc.mod, range, resolvedLines: nc.mod.lines.map((l) => applyRange(l, range)) });
      usedGroups.add(nc.mod.group);
      notableNames.push(nc.notableName);
    }
    if (prefixes.length >= maxPreNotables && suffixes.length >= maxSufNotables) break;
  }

  // Fill remaining prefix/suffix slots with "Added Small Passive Skills also grant: ..." mods
  const smallMods = data.clusters.mods
    .filter((m) => {
      if (m.affix === 'Notable' || m.lvl > itemLevel) return false;
      if (!m.lines.some((l) => /^Added Small Passive Skills also grant:/i.test(l))) return false;
      return modWeightForTag(m, smallTags) > 0;
    })
    .map((m) => {
      const statLines = m.lines.map((l) => l.replace(/^Added Small Passive Skills also grant:\s*/i, ''));
      return { mod: m, score: Math.max(1, scoreStats(statLines) + m.lvl * 0.25) };
    })
    .sort((a, b) => b.score - a.score);

  const addedSmallLines: string[] = [];
  for (const sm of smallMods) {
    if (prefixes.length >= 2 && suffixes.length >= 2) break;
    if (usedGroups.has(sm.mod.group)) continue;
    if (sm.mod.t === 'P' && prefixes.length >= 2) continue;
    if (sm.mod.t === 'S' && suffixes.length >= 2) continue;
    const range = isTrade ? 0.7 + rng.next() * 0.3 : 0.45 + rng.next() * 0.45;
    const resolvedLines = sm.mod.lines.map((l) => applyRange(l, range));
    const entry = { mod: sm.mod, range, resolvedLines };
    if (sm.mod.t === 'P') prefixes.push(entry);
    else suffixes.push(entry);
    usedGroups.add(sm.mod.group);
    for (const rl of resolvedLines) {
      addedSmallLines.push(rl.replace(/^Added Small Passive Skills also grant:\s*/i, ''));
    }
  }

  const nodeCount = baseName === 'Large Cluster Jewel'
    ? (isTrade ? 8 : rng.pick([8, 9]))
    : baseName === 'Medium Cluster Jewel'
      ? (isTrade ? 4 : rng.pick([4, 5]))
      : (isTrade ? 2 : rng.pick([2, 3]));
  const socketCount = baseName === 'Small Cluster Jewel' ? 0 : wantSockets;

  const subgraph = buildClusterSubgraph(
    data,
    baseName,
    chosenSkill.skill,
    nodeCount,
    socketCount,
    notableNames,
    addedSmallLines,
    parentSocketId,
    parentIdBits,
  );
  if (!subgraph) return null;

  const implicits: string[] = [`Adds ${nodeCount} Passive Skills`];
  if (socketCount === 1) implicits.push('1 Added Passive Skill is a Jewel Socket');
  else if (socketCount === 2) implicits.push('2 Added Passive Skills are Jewel Sockets');
  implicits.push(...chosenSkill.skill.enchant);

  const explicits = [
    ...prefixes.flatMap((p) => p.resolvedLines),
    ...suffixes.flatMap((s) => s.resolvedLines),
  ];
  const name = `${rng.pick(CLUSTER_NAME_FIRST)} ${rng.pick(CLUSTER_NAME_SECOND)}`;
  const rawText = buildClusterRawText(
    name,
    baseName,
    itemLevel,
    chosenSkill.skillId,
    nodeCount,
    implicits,
    prefixes,
    suffixes,
  );

  return {
    jewel: {
      socketNodeId: parentSocketId,
      baseName,
      name,
      itemLevel,
      skillId: chosenSkill.skillId,
      skillName: chosenSkill.skill.name,
      nodeCount,
      socketCount,
      implicits,
      explicits,
      prefixes,
      suffixes,
      rawText,
      allocatedNodeIds: [],
    },
    subgraph,
  };
}

function shortestPathInSubgraph(
  nodes: Record<number, TreeNode>,
  allocated: Set<number>,
  targetId: number,
): number[] | null {
  if (allocated.has(targetId)) return [];
  const prev = new Map<number, number>();
  const q: number[] = [...allocated];
  const seen = new Set<number>(allocated);
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cn = nodes[cur];
    if (!cn) continue;
    for (const nxt of cn.adj) {
      if (!nodes[nxt] || seen.has(nxt)) continue;
      seen.add(nxt);
      prev.set(nxt, cur);
      if (nxt === targetId) {
        const path: number[] = [];
        let p: number | undefined = targetId;
        while (p !== undefined && !allocated.has(p)) {
          path.push(p);
          p = prev.get(p);
        }
        return path.reverse();
      }
      q.push(nxt);
    }
  }
  return null;
}

export function allocateClusterJewelsForTree(
  data: GameData,
  arch: BuildArchetype,
  rng: Rng,
  mainAllocated: Set<number>,
  pointsUsed: number,
  pointsBudget: number,
  scoreStats: (stats?: string[]) => number,
): ClusterAllocationResult {
  const clusterNodes: Record<number, TreeNode> = {};
  const allocatedNodeIds: number[] = [];
  const jewelSockets: number[] = [];
  const clusterJewels: GeneratedClusterJewel[] = [];
  const isTrade = arch.options.economy === 'trade';

  // Find allocated outer Large cluster jewel sockets (size === 2)
  const outerLargeSockets = [...mainAllocated].filter((id) => data.clusters.sockets[String(id)]?.size === 2);
  if (outerLargeSockets.length === 0) {
    return { clusterNodes, allocatedNodeIds, jewelSockets, clusterJewels, pointsSpent: 0 };
  }

  let remaining = pointsBudget - pointsUsed;
  const maxLargeClusters = isTrade ? Math.min(2, outerLargeSockets.length) : 1;
  let pointsSpent = 0;

  for (let li = 0; li < maxLargeClusters && remaining >= 5; li++) {
    const outerId = outerLargeSockets[li];
    const wantLargeSockets = remaining >= 10 && isTrade ? 2 : remaining >= 7 ? 2 : 1;
    const largeRoll = rollOneClusterJewel(
      data,
      arch,
      rng.fork(`cluster-L-${outerId}`),
      scoreStats,
      'Large Cluster Jewel',
      outerId,
      0x10000,
      wantLargeSockets,
    );
    if (!largeRoll) continue;

    // Register all Large subgraph nodes so canvas can display the cluster cleanly
    for (const [nidStr, tn] of Object.entries(largeRoll.subgraph.nodes)) {
      clusterNodes[Number(nidStr)] = tn;
    }

    const subAlloc = new Set<number>([largeRoll.subgraph.entranceId]);
    remaining--;
    pointsSpent++;

    // Sort notables/sockets in Large subgraph so front notables + sockets get allocated efficiently
    const largeTargets = [
      ...largeRoll.subgraph.notableIds.filter((id) => {
        const p = shortestPathInSubgraph(largeRoll.subgraph.nodes, subAlloc, id);
        return p !== null;
      }),
    ];

    // Allocate front notable(s) + socket(s) cleanly within remaining budget
    for (const targetSocketId of largeRoll.subgraph.socketIds) {
      const path = shortestPathInSubgraph(largeRoll.subgraph.nodes, subAlloc, targetSocketId);
      if (!path || path.length > remaining) continue;
      for (const pid of path) {
        subAlloc.add(pid);
        remaining--;
        pointsSpent++;
      }
    }
    for (const targetNotId of largeTargets) {
      const path = shortestPathInSubgraph(largeRoll.subgraph.nodes, subAlloc, targetNotId);
      if (!path || path.length > remaining || path.length > 2) continue;
      for (const pid of path) {
        subAlloc.add(pid);
        remaining--;
        pointsSpent++;
      }
    }

    const largeAllocated = [...subAlloc];
    largeRoll.jewel.allocatedNodeIds = largeAllocated;
    allocatedNodeIds.push(...largeAllocated);
    clusterJewels.push(largeRoll.jewel);

    // Optional Medium / Small cluster inside the allocated Medium socket(s) of this Large cluster
    const allocatedMedSockets = largeRoll.subgraph.socketIds.filter((sid) => subAlloc.has(sid));
    const maxMedPerLarge = isTrade ? 2 : 1;
    let medFilled = 0;
    for (let mi = 0; mi < allocatedMedSockets.length; mi++) {
      const medSocketId = allocatedMedSockets[mi];
      if (medFilled >= maxMedPerLarge || remaining < 4) {
        jewelSockets.push(medSocketId);
        continue;
      }
      // Can socket Medium or Small directly into a Medium expansion socket!
      const useSmallDirect = !isTrade || remaining < 5 || (mi === 1 && rng.chance(0.55));
      const childBase: 'Medium Cluster Jewel' | 'Small Cluster Jewel' = useSmallDirect
        ? 'Small Cluster Jewel'
        : 'Medium Cluster Jewel';
      const wantChildSockets = childBase === 'Medium Cluster Jewel' && remaining >= 6 && isTrade ? 1 : 0;

      const childRoll = rollOneClusterJewel(
        data,
        arch,
        rng.fork(`cluster-M-${medSocketId}`),
        scoreStats,
        childBase,
        medSocketId,
        largeRoll.subgraph.idBase,
        wantChildSockets,
      );
      if (!childRoll) {
        jewelSockets.push(medSocketId);
        continue;
      }
      medFilled++;

      for (const [nidStr, tn] of Object.entries(childRoll.subgraph.nodes)) {
        clusterNodes[Number(nidStr)] = tn;
      }
      const childAlloc = new Set<number>([childRoll.subgraph.entranceId]);
      remaining--;
      pointsSpent++;

      for (const nid of childRoll.subgraph.notableIds) {
        const path = shortestPathInSubgraph(childRoll.subgraph.nodes, childAlloc, nid);
        if (!path || path.length > remaining) continue;
        for (const pid of path) {
          childAlloc.add(pid);
          remaining--;
          pointsSpent++;
        }
      }
      for (const sid of childRoll.subgraph.socketIds) {
        const path = shortestPathInSubgraph(childRoll.subgraph.nodes, childAlloc, sid);
        if (!path || path.length > remaining) continue;
        for (const pid of path) {
          childAlloc.add(pid);
          remaining--;
          pointsSpent++;
        }
      }

      const childAllocatedIds = [...childAlloc];
      childRoll.jewel.allocatedNodeIds = childAllocatedIds;
      allocatedNodeIds.push(...childAllocatedIds);
      clusterJewels.push(childRoll.jewel);

      // Add any allocated inner Small sockets (to hold normal Base Jewels or Small Clusters!)
      for (const sid of childRoll.subgraph.socketIds) {
        if (childAlloc.has(sid)) {
          if (remaining >= 3 && isTrade) {
            const smallRoll = rollOneClusterJewel(
              data,
              arch,
              rng.fork(`cluster-S-${sid}`),
              scoreStats,
              'Small Cluster Jewel',
              sid,
              childRoll.subgraph.idBase,
              0,
            );
            if (smallRoll) {
              for (const [nidStr, tn] of Object.entries(smallRoll.subgraph.nodes)) {
                clusterNodes[Number(nidStr)] = tn;
              }
              const sAlloc = new Set<number>([smallRoll.subgraph.entranceId]);
              remaining--;
              pointsSpent++;
              for (const snid of smallRoll.subgraph.notableIds) {
                const path = shortestPathInSubgraph(smallRoll.subgraph.nodes, sAlloc, snid);
                if (!path || path.length > remaining) continue;
                for (const pid of path) {
                  sAlloc.add(pid);
                  remaining--;
                  pointsSpent++;
                }
              }
              smallRoll.jewel.allocatedNodeIds = [...sAlloc];
              allocatedNodeIds.push(...sAlloc);
              clusterJewels.push(smallRoll.jewel);
              continue;
            }
          }
          jewelSockets.push(sid);
        }
      }
    }
  }

  return { clusterNodes, allocatedNodeIds, jewelSockets, clusterJewels, pointsSpent };
}
