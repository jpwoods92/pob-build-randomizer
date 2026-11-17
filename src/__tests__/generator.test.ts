import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GameData } from '../lib/types.ts';
import { generateBuild } from '../lib/generator.ts';
import { canSupportSkill } from '../lib/skills.ts';
import type { BuildOptions } from '../lib/archetype.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const loadJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(root, 'src/data', name), 'utf8')) as T;

const data: GameData = {
  tree: loadJson('tree.json'),
  gems: loadJson('gems.json'),
  bases: loadJson('bases.json'),
  mods: loadJson('mods.json'),
  uniques: loadJson('uniques.json'),
  pantheons: loadJson('pantheons.json'),
};

function baseOptions(overrides: Partial<BuildOptions> = {}): BuildOptions {
  return {
    seed: 'wraeclast-test',
    leagueMode: 'softcore',
    economy: 'trade',
    classId: 'random',
    ascendancyIndex: 'random',
    level: 92,
    damageStyle: 'random',
    defenseStyle: 'random',
    ...overrides,
  };
}

function isTreeConnected(buildTree: Awaited<ReturnType<typeof generateBuild>>['tree'], classId: number, ascIdx: number): boolean {
  const cls = data.tree.classes.find((c) => c.id === classId)!;
  const asc = cls.ascendancies[ascIdx - 1]!;
  const allocSet = new Set(buildTree.nodes);

  // Check ascendancy connectivity from asc.start
  const ascAlloc = buildTree.nodes.filter((id) => data.tree.nodes[id]?.a);
  if (asc.start && ascAlloc.length > 0) {
    const visited = new Set<number>([asc.start]);
    const q = [asc.start];
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const nxt of data.tree.nodes[cur]?.adj ?? []) {
        if (allocSet.has(nxt) && !visited.has(nxt)) {
          visited.add(nxt);
          q.push(nxt);
        }
      }
    }
    for (const id of ascAlloc) {
      if (!visited.has(id)) return false;
    }
  }

  // Check main tree connectivity from cls.start (plus any allocated Path of the ... bridge nodes)
  const mainAlloc = buildTree.nodes.filter((id) => !data.tree.nodes[id]?.a);
  const visitedMain = new Set<number>([cls.start]);
  const qMain = [cls.start];
  for (const id of ascAlloc) {
    const n = data.tree.nodes[id];
    if (n?.n.startsWith('Path of the ')) {
      for (const adj of n.adj) {
        if (allocSet.has(adj) && !data.tree.nodes[adj]?.a) {
          visitedMain.add(adj);
          qMain.push(adj);
        }
      }
    }
  }
  while (qMain.length > 0) {
    const cur = qMain.shift()!;
    for (const nxt of data.tree.nodes[cur]?.adj ?? []) {
      if (allocSet.has(nxt) && !data.tree.nodes[nxt]?.a && !visitedMain.has(nxt)) {
        visitedMain.add(nxt);
        qMain.push(nxt);
      }
    }
  }
  for (const id of mainAlloc) {
    if (!visitedMain.has(id)) return false;
  }
  return true;
}

test('determinism: identical seed and options yield identical PoB code', async () => {
  const opts = baseOptions({ seed: 'deterministic-42', leagueMode: 'hardcore', economy: 'ssf' });
  const a = await generateBuild(data, opts);
  const b = await generateBuild(data, opts);
  assert.equal(a.pobCode, b.pobCode);
  assert.equal(a.xml, b.xml);
});

test('all 21 ascendancies generate connected passive trees and valid PoB codes', async () => {
  for (const cls of data.tree.classes) {
    for (let ascIdx = 1; ascIdx <= cls.ascendancies.length; ascIdx++) {
      const build = await generateBuild(
        data,
        baseOptions({
          seed: `cls-${cls.id}-asc-${ascIdx}`,
          classId: cls.id,
          ascendancyIndex: ascIdx,
          leagueMode: ascIdx % 2 === 0 ? 'hardcore' : 'softcore',
          economy: cls.id % 2 === 0 ? 'ssf' : 'trade',
        }),
      );

      assert.equal(
        isTreeConnected(build.tree, cls.id, ascIdx),
        true,
        `Disconnected tree for ${cls.name} / ${build.archetype.ascendancy.name}`,
      );
      assert.ok(build.tree.ascPointsUsed <= 8);
      assert.equal(build.tree.pointsUsed, build.tree.pointsBudget);

      // Verify mastery effect IDs belong to the allocated mastery node
      for (const [mIdStr, effId] of Object.entries(build.tree.masteryEffects)) {
        const node = data.tree.nodes[mIdStr];
        assert.ok(node && node.t === 'mastery');
        assert.ok(node.me?.some((e) => e.e === effId));
      }

      // Verify PoB import code inflates cleanly back to XML
      const b64 = build.pobCode.replace(/-/g, '+').replace(/_/g, '/');
      const inflated = inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
      assert.equal(inflated, build.xml);
      assert.ok(inflated.includes('<PathOfBuilding>'));
      assert.ok(inflated.includes('</PathOfBuilding>'));
      assert.ok(inflated.includes(`ascendClassName="${build.archetype.ascendancy.internal}"`));

      // Every jewel socket itemId exists in items
      const itemIds = new Set(build.gear.items.map((i) => i.id));
      for (const itemId of Object.values(build.gear.jewelMap)) {
        assert.ok(itemIds.has(itemId));
      }
      for (const itemId of Object.values(build.gear.slotMap)) {
        assert.ok(itemIds.has(itemId));
      }
    }
  }
});

test('knobs: SSF excludes awakened supports & chase uniques; Hardcore ensures strong resists & guard', async () => {
  for (let i = 0; i < 12; i++) {
    const ssfHc = await generateBuild(
      data,
      baseOptions({ seed: `hc-ssf-${i}`, leagueMode: 'hardcore', economy: 'ssf' }),
    );
    for (const grp of ssfHc.skills.groups) {
      for (const gi of grp.gems) {
        assert.ok(!gi.gem.tags.includes('awakened'), `SSF should not include awakened gem: ${gi.gem.name}`);
      }
    }
    for (const item of ssfHc.gear.items) {
      if (item.rarity === 'UNIQUE') {
        assert.ok(!/Mageblood|Headhunter|Ashes of the Stars|Abyssus/i.test(item.name));
      }
    }
    assert.ok(ssfHc.skills.groups.some((g) => g.label.includes('Guard')), 'HC build should have a Guard skill group');
  }
});

test('support matching: Spell Echo supports Fireball, not Cleave', () => {
  const fireball = data.gems.find((g) => g.name === 'Fireball')!;
  const cleave = data.gems.find((g) => g.name === 'Cleave')!;
  const spellEcho = data.gems.find((g) => g.name === 'Spell Echo')!;
  const multistrike = data.gems.find((g) => g.name === 'Multistrike')!;
  assert.equal(canSupportSkill(spellEcho, fireball), true);
  assert.equal(canSupportSkill(spellEcho, cleave), false);
  assert.equal(canSupportSkill(multistrike, cleave), true);
  assert.equal(canSupportSkill(multistrike, fireball), false);
});

test('synergy: no duplicate mastery effects, no conflicting weapon masteries unless Varunastra, no mixed trap/mine', async () => {
  const weaponMasteryMap: Record<string, string> = {
    'Axe Mastery': 'axe',
    'Sword Mastery': 'sword',
    'Mace Mastery': 'mace',
    'Claw Mastery': 'claw',
    'Dagger Mastery': 'dagger',
    'Wand Mastery': 'wand',
    'Staff Mastery': 'staff',
    'Bow Mastery': 'bow',
  };

  for (let i = 0; i < 20; i++) {
    const build = await generateBuild(
      data,
      baseOptions({
        seed: `synergy-${i}`,
        leagueMode: i % 2 === 0 ? 'hardcore' : 'softcore',
        economy: i % 3 === 0 ? 'ssf' : 'trade',
      }),
    );

    // 1. No duplicate mastery effects across the tree
    const effIds = Object.values(build.tree.masteryEffects);
    assert.equal(new Set(effIds).size, effIds.length, `Duplicate mastery effects on seed synergy-${i}`);

    // 2. Weapon masteries match weaponClass (or 1H melee set when Varunastra is equipped)
    const hasVarunastra = build.gear.items.some((item) => item.name === 'Varunastra');
    assert.equal(hasVarunastra, build.archetype.countsAsAllOneHandMelee);
    for (const m of build.tree.summary.masteries) {
      const reqWc = weaponMasteryMap[m.name];
      if (reqWc) {
        if (hasVarunastra) {
          assert.ok(['sword', 'axe', 'mace', 'claw', 'dagger'].includes(reqWc));
        } else {
          assert.equal(reqWc, build.archetype.weaponClass, `Unexpected ${m.name} for ${build.archetype.weaponClass}`);
        }
      }
    }

    // 3. Never mix Trap Mastery and Mine Mastery
    const mNames = new Set(build.tree.summary.masteries.map((m) => m.name));
    assert.ok(!(mNames.has('Trap Mastery') && mNames.has('Mine Mastery')));

    // 4. Main skill must have real damage/minion calculation (or be a Link skill on a link_support build)
    const main = build.archetype.mainSkill;
    const isMercLink = build.archetype.damageStyle === 'link_support' && main.tags.includes('link');
    assert.ok(
      isMercLink || main.types.includes('Attack') || main.types.includes('Damage') || main.types.includes('DamageOverTime') || main.types.includes('CreatesMinion'),
      `Main skill ${main.name} lacks damage/minion/link type`,
    );
    const supNames = new Set(build.skills.groups[0].gems.slice(1).map((g) => g.gem.name));
    assert.ok(!(supNames.has('Fire Penetration') && supNames.has('Physical to Lightning')));
    assert.ok(!(supNames.has('Cold Penetration') && supNames.has('Physical to Lightning')));
    assert.ok(!(supNames.has('Elemental Focus') && (supNames.has('Combustion') || supNames.has('Hypothermia') || supNames.has('Innervate'))));
  }
});

test('chaos inoculation builds skip chaos resistance on tree and gear', async () => {
  let ciCount = 0;
  for (let i = 0; i < 12; i++) {
    const build = await generateBuild(
      data,
      baseOptions({
        seed: `ci-check-${i}`,
        classId: 3, // Witch
        defenseStyle: 'es',
        leagueMode: i % 2 === 0 ? 'hardcore' : 'softcore',
      }),
    );
    if (!build.tree.summary.keystones.includes('Chaos Inoculation')) continue;
    ciCount++;

    for (const id of build.tree.nodes) {
      const node = data.tree.nodes[id];
      const txt = (node?.s ?? []).join(' ').toLowerCase();
      assert.ok(!/chaos resistance/.test(txt), `CI tree should not allocate chaos res node: ${node?.n}`);
      if (node?.n !== 'Chaos Inoculation' && !/\bminions?\b/.test(txt)) {
        assert.ok(!/\bmaximum life\b|life leech|life regeneration|regenerate .* life/.test(txt), `CI tree should not allocate life node: ${node?.n}`);
      }
    }
    for (const item of build.gear.items) {
      assert.notEqual(item.baseName, 'Amethyst Flask');
      if (item.rarity !== 'UNIQUE') {
        const modTxt = item.explicits.join(' ').toLowerCase();
        assert.ok(!/chaos resistance/.test(modTxt), `CI rare/magic item ${item.name} should not roll chaos res`);
        assert.ok(!/\bmaximum life\b|life regeneration|regenerate .* life|life leech/.test(modTxt), `CI rare/magic item ${item.name} should not roll life mods`);
      }
    }
    assert.equal(build.defenses.maxLife, 1);
    assert.equal(build.defenses.chaosMaxHit, null);
    assert.ok(build.defenses.maxEs > 0);
    assert.ok(build.defenses.physMaxHit > 0);
    assert.ok(build.defenses.eleMaxHit > 0);
  }
  assert.ok(ciCount > 0, 'Expected at least one ES Witch build to allocate Chaos Inoculation');
});

test('projected defenses produce valid life, ES, and max hit figures', async () => {
  const build = await generateBuild(data, baseOptions({ seed: 'def-proj-1', classId: 1, defenseStyle: 'life' }));
  assert.ok(build.defenses.maxLife > 1000, `Expected maxLife > 1000, got ${build.defenses.maxLife}`);
  assert.ok(build.defenses.maxMana >= 0, `Expected non-negative maxMana, got ${build.defenses.maxMana}`);
  assert.ok(build.defenses.physMaxHit >= build.defenses.maxLife, 'Phys max hit should be >= maxLife');
  assert.ok(build.defenses.eleMaxHit > build.defenses.maxLife, 'Ele max hit should exceed maxLife with positive ele res');
  assert.ok(build.defenses.chaosMaxHit !== null && build.defenses.chaosMaxHit > 0);
});

test('keystones are only allocated when directly beneficial to the build', async () => {
  for (let i = 0; i < 20; i++) {
    const build = await generateBuild(data, baseOptions({ seed: `ks-synergy-${i}`, classId: (i % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6 }));
    const ks = new Set(build.tree.summary.keystones);
    assert.ok(!ks.has('Eternal Youth'), 'Should not pick Eternal Youth without dedicated ES recharge scaling');
    if (build.skills.manaReservedPct > 45) {
      assert.ok(!ks.has('The Agnostic'), 'Should not pick The Agnostic on mana-reserving aura builds');
    }
    if (ks.has('Chaos Inoculation')) {
      assert.ok(!ks.has('Pain Attunement'), 'CI builds are always Full Life and cannot use Pain Attunement');
    }
    if (ks.has('Ghost Reaver')) {
      assert.ok(!ks.has('Wicked Ward'), 'Ghost Reaver and Wicked Ward should be mutually exclusive');
    }
    if (ks.has('Iron Will')) {
      assert.ok(
        build.archetype.damageStyle === 'spell' ||
        (build.archetype.damageStyle === 'totem' && build.archetype.mainSkill.types.includes('Spell')),
        'Iron Will should only be picked on spell builds',
      );
    }
  }
});

test('hardcore prioritizes max-hit conversion/max-res while softcore prioritizes DPS and reports offense', async () => {
  let hcCiChaosConv = 0;
  let hcTotalPhysConvOrMaxRes = 0;
  for (let i = 0; i < 8; i++) {
    const hcCi = await generateBuild(data, baseOptions({
      seed: `hc-ci-${i}`,
      classId: 3, // Witch
      defenseStyle: 'es',
      leagueMode: 'hardcore',
      economy: 'trade',
    }));
    const gearText = hcCi.gear.items.flatMap((it) => [...it.implicits, ...it.explicits]).join('\n');
    if (/taken as chaos/i.test(gearText)) hcCiChaosConv++;
    if (/taken as (fire|cold|lightning|chaos)/i.test(gearText) || /maximum .* resistance/i.test(gearText)) {
      hcTotalPhysConvOrMaxRes++;
    }
    assert.ok(hcCi.offense.totalDps > 0 || hcCi.offense.dpsMode === 'Support');
  }
  assert.ok(hcCiChaosConv >= 2, `Expected Trade HC CI builds to prioritize damage taken as Chaos, got ${hcCiChaosConv}/8`);
  assert.ok(hcTotalPhysConvOrMaxRes >= 6, `Expected HC builds to include max-res or damage-taken conversion, got ${hcTotalPhysConvOrMaxRes}/8`);

  const sc = await generateBuild(data, baseOptions({
    seed: 'sc-dps-1',
    classId: 4, // Duelist
    leagueMode: 'softcore',
    economy: 'trade',
    damageStyle: 'attack',
  }));
  assert.ok(sc.offense.totalDps >= 1_000_000, `Expected SC DPS >= 1,000,000, got ${sc.offense.totalDps}`);

  for (let i = 0; i < 6; i++) {
    const hc = await generateBuild(data, baseOptions({
      seed: `dps-hc-floor-${i}`,
      classId: (i % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      leagueMode: 'hardcore',
      economy: i % 2 === 0 ? 'ssf' : 'trade',
    }));
    if (hc.offense.dpsMode !== 'Support') {
      assert.ok(hc.offense.totalDps >= 100_000, `Expected HC DPS >= 100,000 for ${hc.archetype.title}, got ${hc.offense.totalDps}`);
    }
    const scSample = await generateBuild(data, baseOptions({
      seed: `dps-sc-floor-${i}`,
      classId: (i % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      leagueMode: 'softcore',
      economy: i % 2 === 0 ? 'ssf' : 'trade',
    }));
    if (scSample.offense.dpsMode !== 'Support') {
      assert.ok(scSample.offense.totalDps >= 1_000_000, `Expected SC DPS >= 1,000,000 for ${scSample.archetype.title}, got ${scSample.offense.totalDps}`);
    }
  }
});
