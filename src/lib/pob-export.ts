import type { GameData } from './types.ts';
import type { BuildArchetype } from './archetype.ts';
import type { GeneratedTree } from './tree.ts';
import type { GeneratedSkills } from './skills.ts';
import type { GeneratedGear } from './items.ts';
import type { CalcConfig } from './stats.ts';

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface BuildArtifactInput {
  archetype: BuildArchetype;
  tree: GeneratedTree;
  skills: GeneratedSkills;
  gear: GeneratedGear;
  data: GameData;
  calcConfig?: CalcConfig;
}

export function buildPobXml({ archetype, tree, skills, gear, data, calcConfig }: BuildArtifactInput): string {
  const { options, classData, ascendancy, bandit, pantheonMajor, pantheonMinor } = archetype;
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<PathOfBuilding>');

  // <Build>
  lines.push(
    `\t<Build level="${options.level}" targetVersion="3_0" viewMode="TREE" className="${escAttr(classData.name)}" ascendClassName="${escAttr(ascendancy.internal)}" bandit="${escAttr(bandit)}" pantheonMajorGod="${escAttr(pantheonMajor)}" pantheonMinorGod="${escAttr(pantheonMinor)}" mainSocketGroup="${skills.mainSocketGroupIndex}" characterLevelAutoMode="false"/>`,
  );

  // <Tree>
  const masteryStr = Object.entries(tree.masteryEffects)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([mId, effId]) => `{${mId},${effId}}`)
    .join(',');

  lines.push('\t<Tree activeSpec="1">');
  lines.push(
    `\t\t<Spec title="Randomized (${escAttr(options.leagueMode.toUpperCase())} ${escAttr(options.economy.toUpperCase())})" treeVersion="${escAttr(data.tree.version)}" clusterHashFormatVersion="2" classId="${tree.classId}" ascendClassId="${tree.ascendClassId}" secondaryAscendClassId="0" nodes="${tree.nodes.join(',')}" masteryEffects="${masteryStr}">`,
  );
  lines.push(`\t\t\t<URL>${escText(tree.url)}</URL>`);
  lines.push('\t\t\t<Sockets>');
  for (const [nodeIdStr, itemId] of Object.entries(gear.jewelMap).sort(([a], [b]) => Number(a) - Number(b))) {
    lines.push(`\t\t\t\t<Socket nodeId="${nodeIdStr}" itemId="${itemId}"/>`);
  }
  lines.push('\t\t\t</Sockets>');
  lines.push('\t\t</Spec>');
  lines.push('\t</Tree>');

  // <Skills>
  lines.push('\t<Skills activeSkillSet="1" defaultGemLevel="normalMaximum" defaultGemQuality="20" sortGemsByDPS="true" showSupportGemTypes="ALL">');
  lines.push('\t\t<SkillSet id="1" title="Default">');
  for (const grp of skills.groups) {
    lines.push(
      `\t\t\t<Skill enabled="${grp.enabled}" includeInFullDPS="${grp.includeInFullDps}" label="${escAttr(grp.label)}" slot="${escAttr(grp.slot)}" mainActiveSkill="1" mainActiveSkillCalcs="1">`,
    );
    for (const gi of grp.gems) {
      lines.push(
        `\t\t\t\t<Gem nameSpec="${escAttr(gi.gem.name)}" skillId="${escAttr(gi.gem.skillId)}" gemId="${escAttr(gi.gem.gameId)}" variantId="${escAttr(gi.gem.variantId)}" level="${gi.level}" quality="${gi.quality}" enabled="${gi.enabled}" enableGlobal1="true" enableGlobal2="false" count="1"/>`,
      );
    }
    lines.push('\t\t\t</Skill>');
  }
  lines.push('\t\t</SkillSet>');
  lines.push('\t</Skills>');

  // <Items>
  lines.push('\t<Items activeItemSet="1" useSecondWeaponSet="false" showStatDifferences="true">');
  for (const item of gear.items) {
    const varAttr = item.variant ? ` variant="${item.variant}"` : '';
    lines.push(`\t\t<Item id="${item.id}"${varAttr}>`);
    lines.push(escText(item.rawText));
    lines.push('\t\t</Item>');
  }
  lines.push('\t\t<ItemSet id="1" title="Default" useSecondWeaponSet="false">');
  const flasksActiveInExport = calcConfig
    ? (calcConfig.flasksActive || calcConfig.defensiveFlasksActive)
    : true;
  for (const [slotName, itemId] of Object.entries(gear.slotMap)) {
    const activeAttr = slotName.startsWith('Flask') && flasksActiveInExport ? ' active="true"' : '';
    lines.push(`\t\t\t<Slot name="${escAttr(slotName)}" itemId="${itemId}"${activeAttr}/>`);
  }
  lines.push('\t\t</ItemSet>');
  lines.push('\t</Items>');

  // <Config>
  lines.push('\t<Config activeConfigSet="1">');
  lines.push('\t\t<ConfigSet id="1" title="Default">');
  lines.push(`\t\t\t<Input name="bandit" string="${escAttr(bandit)}"/>`);
  lines.push(`\t\t\t<Input name="pantheonMajorGod" string="${escAttr(pantheonMajor)}"/>`);
  lines.push(`\t\t\t<Input name="pantheonMinorGod" string="${escAttr(pantheonMinor)}"/>`);
  if (options.leagueMode === 'hardcore') {
    lines.push('\t\t\t<Input name="conditionEnemyRareOrUnique" boolean="true"/>');
  }
  if (calcConfig) {
    if (calcConfig.enduranceCharges) lines.push('\t\t\t<Input name="useEnduranceCharges" boolean="true"/>');
    if (calcConfig.frenzyCharges) lines.push('\t\t\t<Input name="useFrenzyCharges" boolean="true"/>');
    if (calcConfig.powerCharges) lines.push('\t\t\t<Input name="usePowerCharges" boolean="true"/>');
    if (calcConfig.killedRecently) lines.push('\t\t\t<Input name="conditionKilledRecently" boolean="true"/>');
    if (calcConfig.hitRecently) lines.push('\t\t\t<Input name="conditionHitRecently" boolean="true"/>');
    if (calcConfig.onslaught) lines.push('\t\t\t<Input name="buffOnslaught" boolean="true"/>');
    if (calcConfig.enemyIntimidated) lines.push('\t\t\t<Input name="conditionEnemyIntimidated" boolean="true"/>');
    if (calcConfig.enemyUnnerved) lines.push('\t\t\t<Input name="conditionEnemyUnnerved" boolean="true"/>');
  }
  lines.push('\t\t</ConfigSet>');
  lines.push('\t</Config>');

  // <Notes>
  const mainGems = skills.groups[0]?.gems.map((g) => g.gem.name).join(' - ') ?? archetype.mainSkill.name;
  const notes = [
    `${archetype.title}`,
    `Seed: ${options.seed}`,
    `Mode: ${options.leagueMode.toUpperCase()} / ${options.economy.toUpperCase()} | Level ${options.level}`,
    `Class: ${classData.name} (${ascendancy.name})`,
    `Style: ${archetype.damageStyle.toUpperCase()} | Defense: ${archetype.defenseStyle.toUpperCase()} | Crit: ${archetype.critMode}`,
    `Main Setup: ${mainGems}`,
    `Passive Points: ${tree.pointsUsed}/${tree.pointsBudget} | Ascendancy: ${tree.ascPointsUsed}/8`,
    `Keystones: ${tree.summary.keystones.length ? tree.summary.keystones.join(', ') : 'None'}`,
    `Est. Resists (after -60% Kitava): ${gear.resists.fire}% Fire / ${gear.resists.cold}% Cold / ${gear.resists.lightning}% Lightning / ${gear.resists.chaos}% Chaos`,
  ].join('\n');
  lines.push(`\t<Notes>${escText(notes)}</Notes>`);

  lines.push('</PathOfBuilding>');
  return lines.join('\n');
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Compresses XML with RFC 1950 zlib ('deflate') and encodes as PoB's URL-safe Base64.
 */
export async function encodePobCode(xml: string): Promise<string> {
  const input = new TextEncoder().encode(xml);
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(input);
  void writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return bytesToBase64(compressed).replace(/\+/g, '-').replace(/\//g, '_');
}

export function buildPoeWikiUrl(title: string): string {
  const slug = title.trim().replace(/\s+/g, '_');
  return `https://www.poewiki.net/wiki/${encodeURI(slug)}`;
}

const WIKI_GEM_ALIASES: Record<string, string> = {
  'Multiple Projectiles': 'Lesser Multiple Projectiles Support',
};

export function getPoeWikiGemUrl(gem: { name: string; support: boolean }): string {
  const alias = WIKI_GEM_ALIASES[gem.name];
  if (alias) return buildPoeWikiUrl(alias);
  const title = gem.support && !gem.name.endsWith(' Support')
    ? `${gem.name} Support`
    : gem.name;
  return buildPoeWikiUrl(title);
}

export function getPoeWikiItemUrl(item: {
  rarity: 'UNIQUE' | 'RARE' | 'MAGIC';
  name: string;
  baseName: string;
}): string {
  const title = item.rarity === 'UNIQUE'
    ? item.name
    : item.baseName.replace(/\s*\([^)]+\)\s*$/, '');
  return buildPoeWikiUrl(title);
}
