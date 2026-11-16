import type { GameData } from './types.ts';
import { Rng } from './rng.ts';
import { pickArchetype, type BuildArchetype, type BuildOptions } from './archetype.ts';
import { generatePassiveTree, type GeneratedTree } from './tree.ts';
import { generateSkills, type GeneratedSkills } from './skills.ts';
import { generateGear, type GeneratedGear } from './items.ts';
import { buildPobXml, encodePobCode } from './pob-export.ts';

export interface GeneratedBuild {
  archetype: BuildArchetype;
  tree: GeneratedTree;
  skills: GeneratedSkills;
  gear: GeneratedGear;
  xml: string;
  pobCode: string;
}

export async function generateBuild(data: GameData, options: BuildOptions): Promise<GeneratedBuild> {
  const rootRng = new Rng(
    `${options.seed}|${options.leagueMode}|${options.economy}|${options.classId}|${options.ascendancyIndex}|${options.level}|${options.damageStyle}|${options.defenseStyle}`,
  );
  const archetype = pickArchetype(data, options, rootRng.fork('arch'));
  const skills = generateSkills(data, archetype, rootRng.fork('skills'));
  const tree = generatePassiveTree(data, archetype, rootRng.fork('tree'), skills.maxReq);
  const gear = generateGear(data, archetype, tree, skills, rootRng.fork('gear'));
  const xml = buildPobXml({ archetype, tree, skills, gear, data });
  const pobCode = await encodePobCode(xml);

  return { archetype, tree, skills, gear, xml, pobCode };
}
