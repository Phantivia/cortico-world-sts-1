import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, root } from './build-mod.mjs';

const paths = build(process.argv[2] || process.env.CORTICO_STS_1_GAME_DIR);
const mods = join(paths.gameDir, 'mods');
mkdirSync(mods, { recursive: true });
if (!existsSync(join(mods, 'BaseMod.jar'))) copyFileSync(paths.base, join(mods, 'BaseMod.jar'));
for (const name of ['CommunicationMod.jar', 'CorticoSts.jar']) {
  const target = join(mods, name);
  if (existsSync(target)) copyFileSync(target, `${target}.backup-${Date.now()}`);
  copyFileSync(join(root, 'dist', name), target);
}
console.log(`Installed CorticoSts and CommunicationMod in ${mods}`);
