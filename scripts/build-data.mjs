#!/usr/bin/env node
// Converts raw Path of Building Lua data + the GGG passive tree export into compact JSON
// consumed by the randomizer at runtime (src/data/*.json).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLuaReturn, parseLuaValue } from './lua-parse.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pobData = join(root, '.cache/pob/src/Data');
const treeFile = join(root, '.cache/tree/data.json');
const outDir = join(root, 'src/data');
mkdirSync(outDir, { recursive: true });

const read = (p) => readFileSync(p, 'utf8');
const write = (name, obj) => {
  const json = JSON.stringify(obj);
  writeFileSync(join(outDir, name), json);
  console.log(`wrote src/data/${name} (${(json.length / 1024).toFixed(0)} KB)`);
};

// ---------------------------------------------------------------------------
// Passive tree
// ---------------------------------------------------------------------------
function orbitAngles(count) {
  let deg;
  if (count === 16) deg = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
  else if (count === 40) deg = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350];
  else deg = Array.from({ length: count }, (_, i) => (360 * i) / count);
  return deg.map((d) => (d * Math.PI) / 180);
}

function buildTree() {
  const raw = JSON.parse(read(treeFile));
  const { orbitRadii, skillsPerOrbit } = raw.constants;
  const angles = skillsPerOrbit.map(orbitAngles);

  const excluded = new Set();
  for (const [id, n] of Object.entries(raw.nodes)) {
    if (id === 'root') { excluded.add(id); continue; }
    const g = raw.groups[n.group];
    if (
      n.isProxy || n.isBlighted || n.isBloodline ||
      (g && g.isProxy) ||
      (n.expansionJewel && n.expansionJewel.size < 2) ||
      n.group === undefined
    ) {
      excluded.add(id);
    }
  }
  // Ascendancies from the alternate set (bloodlines) are excluded via isBloodline above.

  const nodes = {};
  for (const [id, n] of Object.entries(raw.nodes)) {
    if (excluded.has(id)) continue;
    const g = raw.groups[n.group];
    const a = angles[n.orbit][n.orbitIndex] ?? 0;
    const r = orbitRadii[n.orbit];
    let type = 'normal';
    if (n.classStartIndex !== undefined) type = 'start';
    else if (n.isAscendancyStart) type = 'ascStart';
    else if (n.isKeystone) type = 'keystone';
    else if (n.isMastery) type = 'mastery';
    else if (n.isJewelSocket) type = 'jewel';
    else if (n.isNotable) type = 'notable';
    const adj = new Set();
    for (const o of [...(n.out || []), ...(n.in || [])]) {
      if (!excluded.has(o) && raw.nodes[o]) adj.add(Number(o));
    }
    const node = {
      n: n.name,
      t: type,
      x: Math.round(g.x + Math.sin(a) * r),
      y: Math.round(g.y - Math.cos(a) * r),
      adj: [...adj],
    };
    if (n.stats && n.stats.length) node.s = n.stats;
    if (n.ascendancyName) node.a = n.ascendancyName;
    if (n.classStartIndex !== undefined) node.cls = n.classStartIndex;
    if (n.grantedPassivePoints) node.gp = n.grantedPassivePoints;
    if (n.isMultipleChoice) node.mc = 1;
    if (n.isMultipleChoiceOption) node.mco = 1;
    if (n.masteryEffects) node.me = n.masteryEffects.map((e) => ({ e: e.effect, s: e.stats }));
    if (n.grantedStrength) node.gs = n.grantedStrength;
    if (n.grantedDexterity) node.gd = n.grantedDexterity;
    if (n.grantedIntelligence) node.gi = n.grantedIntelligence;
    nodes[id] = node;
  }

  // Mastery nodes in the export only link to notables via "in". Make adjacency symmetric.
  for (const [id, node] of Object.entries(nodes)) {
    for (const o of node.adj) {
      const other = nodes[o];
      if (other && !other.adj.includes(Number(id))) other.adj.push(Number(id));
    }
  }

  const classes = raw.classes.map((c, i) => {
    const start = Object.entries(nodes).find(([, n]) => n.cls === i);
    return {
      id: i,
      name: c.name,
      str: c.base_str,
      dex: c.base_dex,
      int: c.base_int,
      start: Number(start[0]),
      ascendancies: c.ascendancies.map((a, j) => {
        const st = Object.entries(nodes).find(([, n]) => n.t === 'ascStart' && n.a === a.id);
        return { id: j + 1, internal: a.id, name: a.name, start: st ? Number(st[0]) : null };
      }),
    };
  });

  return {
    version: '3_30',
    urlVersion: '3.30.0',
    points: raw.points,
    bounds: { minX: raw.min_x, minY: raw.min_y, maxX: raw.max_x, maxY: raw.max_y },
    classes,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// Gems + skills
// ---------------------------------------------------------------------------
function parseSkillFiles() {
  const skills = {};
  const dir = join(pobData, 'Skills');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.lua')) continue;
    const src = read(join(dir, file));
    const re = /^skills\["([^"]+)"\] = \{/gm;
    const starts = [];
    let m;
    while ((m = re.exec(src))) starts.push({ id: m[1], pos: m.index });
    starts.forEach((s, i) => {
      const block = src.slice(s.pos, i + 1 < starts.length ? starts[i + 1].pos : src.length);
      const field = (name) => {
        const fm = new RegExp(`^\\t${name} = (.*?),?\\r?$`, 'm').exec(block);
        return fm ? fm[1] : undefined;
      };
      const typeList = (name) => {
        const v = field(name);
        if (!v) return [];
        return [...v.matchAll(/SkillType\.(\w+)/g)].map((x) => x[1]);
      };
      const lvl20 = /\[20\] = \{([^\n]*)\}/.exec(block) || /\[1\] = \{([^\n]*)\}/.exec(block);
      const lvl = lvl20 ? lvl20[1] : '';
      const num = (k) => {
        const mm = new RegExp(`${k} = ([\\d.]+)`).exec(lvl);
        return mm ? Number(mm[1]) : undefined;
      };
      const weaponTypes = field('weaponTypes') !== undefined
        ? [...(/\tweaponTypes = \{([\s\S]*?)\n\t\}/.exec(block)?.[1] ?? '').matchAll(/\["([^"]+)"\]/g)].map((x) => x[1])
        : [];
      const desc = /^\tdescription = "((?:[^"\\]|\\.)*)"/m.exec(block);
      skills[s.id] = {
        name: /^\tname = "([^"]*)"/m.exec(block)?.[1],
        color: Number(field('color') ?? 0),
        support: field('support') === 'true',
        hidden: field('hidden') === 'true',
        legacy: field('legacy') === 'true',
        types: typeList('skillTypes'),
        minionTypes: typeList('minionSkillTypes'),
        require: typeList('requireSkillTypes'),
        exclude: typeList('excludeSkillTypes'),
        add: typeList('addSkillTypes'),
        weaponTypes,
        isTrigger: field('isTrigger') === 'true',
        ignoreMinionTypes: field('ignoreMinionTypes') === 'true',
        cannotBeSupported: field('cannotBeSupported') === 'true',
        supportGemsOnly: field('supportGemsOnly') === 'true',
        levelReq: num('levelRequirement'),
        reservePct: num('manaReservationPercent'),
        reserveFlat: num('manaReservationFlat'),
        description: desc ? desc[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : undefined,
      };
    });
  }
  return skills;
}

function buildGems() {
  const gemsRaw = parseLuaReturn(read(join(pobData, 'Gems.lua')));
  const skills = parseSkillFiles();
  const gems = [];
  for (const [key, g] of Object.entries(gemsRaw)) {
    const tags = Object.keys(g.tags || {});
    if (g.vaalGem || tags.includes('vaal')) continue;
    const sk = skills[g.grantedEffectId];
    if (!sk || sk.legacy) continue;
    gems.push({
      key,
      gameId: g.gameId,
      variantId: g.variantId,
      skillId: g.grantedEffectId,
      name: g.name,
      tags,
      str: g.reqStr || 0,
      dex: g.reqDex || 0,
      int: g.reqInt || 0,
      maxLevel: g.naturalMaxLevel || 20,
      support: sk.support,
      color: sk.color,
      types: sk.types,
      minionTypes: sk.minionTypes.length ? sk.minionTypes : undefined,
      require: sk.require.length ? sk.require : undefined,
      exclude: sk.exclude.length ? sk.exclude : undefined,
      add: sk.add.length ? sk.add : undefined,
      weaponTypes: sk.weaponTypes.length ? sk.weaponTypes : undefined,
      isTrigger: sk.isTrigger || undefined,
      ignoreMinionTypes: sk.ignoreMinionTypes || undefined,
      levelReq: sk.levelReq,
      reservePct: sk.reservePct,
      reserveFlat: sk.reserveFlat,
      description: sk.description,
    });
  }
  return gems;
}

// ---------------------------------------------------------------------------
// Item bases
// ---------------------------------------------------------------------------
function buildBases() {
  const bases = {};
  const dir = join(pobData, 'Bases');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.lua')) continue;
    const src = read(join(dir, file));
    const re = /^itemBases\["([^"]+)"\] = /gm;
    let m;
    while ((m = re.exec(src))) {
      const { value } = parseLuaValue(src, m.index + m[0].length);
      if (value.hidden) continue;
      const b = {
        type: value.type,
        tags: Object.keys(value.tags || {}),
        req: value.req || {},
      };
      if (value.subType) b.subType = value.subType;
      if (value.implicit) b.implicit = value.implicit;
      if (value.socketLimit) b.sockets = value.socketLimit;
      if (value.weapon) b.weapon = value.weapon;
      if (value.armour) b.armour = value.armour;
      if (value.flask) b.flask = { ...value.flask };
      bases[m[1]] = b;
    }
  }
  return bases;
}

// ---------------------------------------------------------------------------
// Mods
// ---------------------------------------------------------------------------
function compactMods(file, { maxLevel = 100 } = {}) {
  const raw = parseLuaReturn(read(join(pobData, file)));
  const out = [];
  for (const [id, m] of Object.entries(raw)) {
    if (m.type !== 'Prefix' && m.type !== 'Suffix') continue;
    if (!m.weightVal || !m.weightVal.some((w) => w > 0)) continue;
    if (m.level > maxLevel) continue;
    const lines = m.__array || [];
    if (!lines.length) continue;
    out.push({
      id,
      t: m.type === 'Prefix' ? 'P' : 'S',
      affix: m.affix,
      lines,
      lvl: m.level,
      group: m.group,
      wk: m.weightKey,
      wv: m.weightVal,
      tags: m.modTags && m.modTags.length ? m.modTags : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Uniques
// ---------------------------------------------------------------------------
function buildUniques(bases) {
  const dir = join(pobData, 'Uniques');
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.lua')) continue;
    const list = parseLuaReturn(read(join(dir, file)));
    for (const text of list) {
      if (typeof text !== 'string') continue;
      const u = parseUnique(text, bases);
      if (u) out.push(u);
    }
  }
  return out;
}

function parseUnique(text, bases) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const name = lines[0];
  const base = lines[1];
  const baseData = bases[base];
  if (!baseData) return null;
  if (/Has Alt Variant|Selected Variant|\{group:/.test(text)) return null;

  const variants = [];
  const versions = [];
  const extra = [];
  const sources = [];
  let league;
  let levelReq;
  let implicitCount = 0;
  let i = 2;
  for (; i < lines.length; i++) {
    const l = lines[i];
    let mm;
    if ((mm = /^Variant: (.*)$/.exec(l))) variants.push(mm[1]);
    else if ((mm = /^Version: (.*)$/.exec(l))) versions.push(mm[1]);
    else if ((mm = /^Source: (.*)$/.exec(l))) sources.push(mm[1]);
    else if ((mm = /^League: (.*)$/.exec(l))) league = mm[1];
    else if ((mm = /^(?:Requires Level|LevelReq:) (\d+)/.exec(l))) levelReq = Number(mm[1]);
    else if (/^(Radius|Limited to): /.test(l)) extra.push(l);
    else if (/^(Upgrade|Crafted|Talisman Tier|Sockets|Rarity|Unreleased): /.test(l)) { /* ignore */ }
    else if ((mm = /^Implicits: (\d+)$/.exec(l))) { implicitCount = Number(mm[1]); i++; break; }
    else break; // mods begin (no Implicits line)
  }
  const modLines = lines.slice(i);
  const implicits = modLines.slice(0, implicitCount);
  const explicits = modLines.slice(implicitCount);
  if (sources.some((s) => /No longer obtainable/i.test(s))) return null;

  const u = {
    name,
    base,
    type: baseData.type,
    implicits,
    explicits,
  };
  if (variants.length) u.variants = variants;
  if (versions.length) u.versions = versions;
  if (extra.length) u.extra = extra;
  if (levelReq) u.levelReq = levelReq;
  if (sources.length) u.source = sources.join('; ');
  if (league) u.league = league;
  return u;
}

// ---------------------------------------------------------------------------
// Pantheon
// ---------------------------------------------------------------------------
function buildPantheons() {
  const raw = parseLuaReturn(read(join(pobData, 'Pantheons.lua')));
  const major = [];
  const minor = [];
  for (const [id, p] of Object.entries(raw)) {
    const name = p.souls?.[1]?.name?.replace(/^Soul of (the )?/, '') ?? id;
    const soulKeys = Object.keys(p.souls || {}).sort((a, b) => Number(a) - Number(b));
    const mods = [];
    for (const k of soulKeys) {
      const s = p.souls[k];
      for (const mk of Object.keys(s.mods || {}).sort((a, b) => Number(a) - Number(b))) {
        const line = s.mods[mk]?.line;
        if (line) mods.push(line);
      }
    }
    (p.isMajorGod ? major : minor).push({ id, name, mods });
  }
  return { major, minor };
}

// ---------------------------------------------------------------------------
// Minions + Monster scaling tables
// ---------------------------------------------------------------------------
function extractLuaBlocks(src, prefixRe) {
  const blocks = {};
  const starts = [];
  let m;
  while ((m = prefixRe.exec(src))) starts.push({ id: m[1], eqPos: m.index + m[0].length });
  for (const s of starts) {
    try {
      const { value } = parseLuaValue(src, s.eqPos);
      blocks[s.id] = value;
    } catch {
      // Skip non-literal entries cleanly
    }
  }
  return blocks;
}

function parseMinionMods(modList) {
  let moreDamage = 1;
  let moreSpeed = 1;
  let incDamage = 0;
  let incSpeed = 0;
  let physMin = 0;
  let physMax = 0;
  for (const entry of modList || []) {
    if (!entry || entry.call !== 'mod' || !Array.isArray(entry.args)) continue;
    const [stat, type, val] = entry.args;
    if (typeof val !== 'number') continue;
    if (stat === 'Damage') {
      if (type === 'MORE') moreDamage *= 1 + val / 100;
      else if (type === 'INC') incDamage += val;
    } else if (stat === 'Speed') {
      if (type === 'MORE') moreSpeed *= 1 + val / 100;
      else if (type === 'INC') incSpeed += val;
    } else if (stat === 'PhysicalMin' && type === 'BASE') {
      physMin += val;
    } else if (stat === 'PhysicalMax' && type === 'BASE') {
      physMax += val;
    }
  }
  return {
    moreDamage: Number(moreDamage.toFixed(3)),
    moreSpeed: Number(moreSpeed.toFixed(3)),
    incDamage,
    incSpeed,
    addedFlat: physMin + physMax > 0 ? Number(((physMin + physMax) / 2).toFixed(1)) : undefined,
  };
}

function resolveLimitInfo(skillId, statsObj) {
  const checks = [
    ['base_number_of_zombies_allowed', 'zombies'],
    ['base_number_of_skeletons_allowed', 'skeletons'],
    ['base_number_of_spectres_allowed', 'spectres'],
    ['base_number_of_golems_allowed', 'golems'],
    ['base_number_of_raging_spirits_allowed', 'srs'],
    ['base_number_of_animated_weapons_allowed', 'weapons'],
    ['base_number_of_reapers_allowed', 'reapers'],
    ['base_number_of_relics_allowed', 'relics'],
    ['base_max_number_of_absolution_sentinels', 'sentinels'],
    ['base_number_of_champions_of_light_allowed', 'sentinels'],
    ['base_max_number_of_dominated_normal_monsters', 'sentinels'],
    ['base_number_of_blink_mirror_arrow_rain_of_arrows_clones', 'clones'],
    ['base_number_of_herald_scorpions_allowed', 'other'],
  ];
  for (const [key, limitType] of checks) {
    if (typeof statsObj[key] === 'number' && statsObj[key] > 0) {
      return { limit: statsObj[key], limitType };
    }
  }
  if (/BlinkArrow|MirrorArrow/.test(skillId)) return { limit: 3, limitType: 'clones' };
  if (/Golem/.test(skillId)) return { limit: 1, limitType: 'golems' };
  return { limit: 1, limitType: 'other' };
}

function buildMinions(gems) {
  const miscSrc = read(join(pobData, 'Misc.lua'));
  const tdMarker = 'data.monsterAllyDamageTable = ';
  const tdIdx = miscSrc.indexOf(tdMarker);
  const { value: allyDamageRaw } = parseLuaValue(miscSrc, tdIdx + tdMarker.length);
  const allyDamageTable = allyDamageRaw.map((v) => Number(Number(v).toFixed(2)));

  // Parse minion skills (for baseMultiplier / spell castTime / combo bonuses)
  const minionSkillBlocks = extractLuaBlocks(read(join(pobData, 'Skills/minion.lua')), /^skills\["([^"]+)"\] = /gm);
  const minionSkills = {};
  for (const [sid, s] of Object.entries(minionSkillBlocks)) {
    const l1 = s.levels?.[1];
    const cs = Object.fromEntries((s.constantStats || []).map((x) => [x[0], x[1]]));
    const l1Arr = l1?.__array || [];
    const avgRatio = l1Arr.length >= 2 && typeof l1Arr[0] === 'number' && typeof l1Arr[1] === 'number'
      ? (l1Arr[0] + l1Arr[1]) / 2
      : 1;
    let skillMoreDmg = 1;
    let skillMoreSpd = 1;
    if (cs['bone_golem_damage_+%_final_after_third_combo_index']) {
      skillMoreDmg *= 1 + cs['bone_golem_damage_+%_final_after_third_combo_index'] / 150;
    }
    if (cs['bone_golem_attack_speed_+%_final_after_third_combo_index']) {
      skillMoreSpd *= 1 + cs['bone_golem_attack_speed_+%_final_after_third_combo_index'] / 150;
    }
    if (cs['active_skill_attack_speed_+%_final']) {
      skillMoreSpd *= Math.max(0.5, 1 + cs['active_skill_attack_speed_+%_final'] / 100);
    }
    minionSkills[sid] = {
      isSpell: Boolean(s.baseFlags?.spell),
      baseMultiplier: typeof l1?.baseMultiplier === 'number' ? l1.baseMultiplier : 1,
      castTime: typeof s.castTime === 'number' ? s.castTime : 1,
      cooldown: typeof l1?.cooldown === 'number' ? l1.cooldown : undefined,
      baseEff: typeof s.baseEffectiveness === 'number' ? s.baseEffectiveness : 1,
      avgRatio,
      moreDmg: Number(skillMoreDmg.toFixed(3)),
      moreSpd: Number(skillMoreSpd.toFixed(3)),
    };
  }

  // Parse all player active skill files to connect minion gems -> minionList, limits, actorLevel
  const playerSkillBlocks = {};
  for (const file of readdirSync(join(pobData, 'Skills'))) {
    if (!file.endsWith('.lua') || file === 'minion.lua' || file.startsWith('sup_')) continue;
    Object.assign(playerSkillBlocks, extractLuaBlocks(read(join(pobData, 'Skills', file)), /^skills\["([^"]+)"\] = /gm));
  }

  const gemMinions = {};
  const neededMinions = new Set();
  for (const g of gems) {
    if (g.support || (!g.types.includes('CreatesMinion') && !g.tags.includes('minion'))) continue;
    const sk = playerSkillBlocks[g.skillId];
    if (!sk) continue;
    const minionList = Array.isArray(sk.minionList) ? sk.minionList.filter((x) => typeof x === 'string') : [];
    const isSpectre = g.skillId.startsWith('RaiseSpectre');
    if (!minionList.length && !isSpectre) continue;

    const statMap = Object.fromEntries((sk.constantStats || []).map((x) => [x[0], x[1]]));
    const stNames = sk.stats || [];
    const l20 = sk.levels?.[20] || sk.levels?.[1];
    if (l20?.__array) {
      stNames.forEach((name, idx) => {
        if (typeof l20.__array[idx] === 'number') statMap[name] = l20.__array[idx];
      });
    }
    const { limit: rawLimit, limitType } = resolveLimitInfo(g.skillId, statMap);
    // Raise Zombie of Falling has dummy cap 200 because zombies immediately expire on impact
    const limit = g.skillId === 'RaiseZombieAltY' ? 1 : rawLimit;
    const actorLevel20 = statMap.base_display_minion_actor_level ?? statMap.raised_spectre_level ?? 70;
    const moreDmgPct = statMap['active_skill_minion_damage_+%_final'] ?? statMap['active_skill_minion_physical_damage_+%_final'] ?? 0;
    const moreSpdPct = statMap['active_skill_minion_attack_speed_+%_final'] ?? 0;
    const minAdd = statMap.attack_minimum_added_physical_damage ?? 0;
    const maxAdd = statMap.attack_maximum_added_physical_damage ?? 0;

    const finalList = isSpectre ? ['DefaultSpectre'] : minionList;
    for (const mid of finalList) neededMinions.add(mid);
    gemMinions[g.skillId] = {
      minionList: finalList,
      limit,
      limitType,
      actorLevel20,
      gemMoreDamage: Number((1 + moreDmgPct / 100).toFixed(3)),
      gemMoreSpeed: Number((1 + moreSpdPct / 100).toFixed(3)),
      addedPhysAvg: Math.round((minAdd + maxAdd) / 2),
      ...(g.skillId === 'HeraldOfAgony' ? { virulenceScale: true } : {}),
    };
  }

  // Parse Minions.lua + Frost Auto-Scout fallback Spectre from Spectres.lua
  const rawMinions = extractLuaBlocks(read(join(pobData, 'Minions.lua')), /^minions\["([^"]+)"\] = /gm);
  const spectreSrc = read(join(pobData, 'Spectres.lua'));
  const spectreBlocks = extractLuaBlocks(spectreSrc, /^minions\["([^"]+)"\] = /gm);
  if (spectreBlocks['Metadata/Monsters/LeagueHeist/Robot/RobotClockworkGolemColdSpectre']) {
    rawMinions.DefaultSpectre = spectreBlocks['Metadata/Monsters/LeagueHeist/Robot/RobotClockworkGolemColdSpectre'];
  }

  const minions = {};
  for (const id of neededMinions) {
    const m = rawMinions[id];
    if (!m) continue;
    const mods = parseMinionMods(m.modList);
    // Pick primary offensive skill from m.skillList (skip Teleport/Consume/QuickDodge/Empowered/high-cooldown skills)
    let bestSk = null;
    for (const sid of m.skillList || []) {
      if (/Teleport|Consume|Dodge|Curse|Taunt|Empowered/i.test(sid)) continue;
      const sk = minionSkills[sid];
      if (!sk) continue;
      if (sk.cooldown && sk.cooldown >= 2) continue;
      if (!bestSk || (sk.isSpell ? sk.baseEff : sk.baseMultiplier * sk.moreDmg) > (bestSk.isSpell ? bestSk.baseEff : bestSk.baseMultiplier * bestSk.moreDmg)) {
        bestSk = sk;
      }
    }
    if (!bestSk) {
      for (const sid of m.skillList || []) {
        if (/Teleport|Consume|Dodge|Curse|Taunt/i.test(sid)) continue;
        const sk = minionSkills[sid];
        if (!sk) continue;
        bestSk = sk;
        break;
      }
    }
    const isSpell = Boolean(bestSk?.isSpell);
    minions[id] = {
      id,
      name: m.name || id,
      damage: typeof m.damage === 'number' ? m.damage : 1,
      attackTime: typeof m.attackTime === 'number' && m.attackTime > 0 ? m.attackTime : 1,
      ...(m.limit ? { limitKey: m.limit } : {}),
      skillMult: isSpell
        ? Number(((bestSk.baseEff || 1) * (bestSk.avgRatio || 1)).toFixed(3))
        : Number((((bestSk?.baseMultiplier || 1) * (bestSk?.moreDmg || 1))).toFixed(3)),
      ...(isSpell ? { isSpell: true, castTime: bestSk.cooldown || bestSk.castTime || 1 } : {}),
      moreDamage: Number((mods.moreDamage * (bestSk?.moreDmg && isSpell ? bestSk.moreDmg : 1)).toFixed(3)),
      moreSpeed: Number((mods.moreSpeed * (bestSk?.moreSpd || 1)).toFixed(3)),
      incDamage: mods.incDamage,
      incSpeed: mods.incSpeed,
      ...(mods.addedFlat ? { addedFlat: mods.addedFlat } : {}),
    };
  }

  return { allyDamageTable, minions, gemMinions };
}

// ---------------------------------------------------------------------------
const tree = buildTree();
write('tree.json', tree);
const gems = buildGems();
write('gems.json', gems);
const bases = buildBases();
write('bases.json', bases);
write('mods.json', {
  item: compactMods('ModExplicit.lua', { maxLevel: 86 }),
  flask: compactMods('ModFlask.lua'),
  jewel: compactMods('ModJewel.lua'),
});
write('uniques.json', buildUniques(bases));
write('pantheons.json', buildPantheons());
write('minions.json', buildMinions(gems));
