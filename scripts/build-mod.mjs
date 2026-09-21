import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const communicationRevision = '5e417eb189530986b9047a3c9426889fb261d146';
export function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
export function gamePaths(gameDir) {
  if (!gameDir) throw new Error('Pass the game directory as the first argument or set CORTICO_STS_GAME_DIR');
  gameDir = resolve(gameDir);
  const workshop = resolve(gameDir, '../../workshop/content/646570');
  const find = (name, workshopId) => {
    const candidates = [join(gameDir, name), join(gameDir, 'mods', name), join(workshop, workshopId, name)];
    const path = candidates.find(existsSync);
    if (!path) throw new Error(`Missing ${name}; install its official Mod or place it under the game mods directory`);
    return path;
  };
  return {
    gameDir,
    game: join(gameDir, 'desktop-1.0.jar'),
    mts: find('ModTheSpire.jar', '1605060445'),
    base: find('BaseMod.jar', '1605833019'),
  };
}
function javaFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? javaFiles(join(dir, e.name)) : e.name.endsWith('.java') ? [join(dir, e.name)] : []);
}
export function build(gameDir) {
  const paths = gamePaths(gameDir);
  const deps = join(root, 'scratch', 'CommunicationMod');
  mkdirSync(join(root, 'scratch'), { recursive: true });
  if (!existsSync(join(deps, '.git'))) run('git', ['clone', 'https://github.com/ForgottenArbiter/CommunicationMod.git', deps]);
  run('git', ['checkout', '--detach', communicationRevision], deps);
  const dist = join(root, 'dist');
  const commClasses = join(root, 'scratch', 'classes-communication');
  const modClasses = join(root, 'scratch', 'classes-sts');
  for (const dir of [dist, commClasses, modClasses]) mkdirSync(dir, { recursive: true });
  const classpath = [paths.game, paths.mts, paths.base].join(delimiter);
  const compile = (sources, output, cp) => {
    const argsFile = join(root, 'scratch', `javac-${output.endsWith('sts') ? 'sts' : 'communication'}.txt`);
    writeFileSync(argsFile, sources.map(s => `"${s.replaceAll('\\', '/')}"`).join('\n'));
    run('javac', ['--release', '8', '-g', '-parameters', '-Xlint:-options', '-proc:none', '-encoding', 'UTF-8', '-cp', cp, '-d', output, `@${argsFile}`]);
  };
  compile(javaFiles(join(deps, 'src/main/java')), commClasses, classpath);
  const metadata = readFileSync(join(deps, 'src/main/resources/ModTheSpire.json'), 'utf8')
    .replaceAll('${project.artifactId}', 'CommunicationMod').replaceAll('${project.name}', 'Communication Mod')
    .replaceAll('${project.description}', 'Game state and action adapters for external programs')
    .replaceAll('${project.version}', '1.2.1').replaceAll('${SlayTheSpire.version}', '12-18-2022')
    .replaceAll('${ModTheSpire.version}', '3.18.1');
  writeFileSync(join(commClasses, 'ModTheSpire.json'), metadata);
  copyFileSync(join(deps, 'src/main/resources/Icon.png'), join(commClasses, 'Icon.png'));
  copyFileSync(join(deps, 'LICENSE'), join(commClasses, 'CommunicationMod-LICENSE.txt'));
  run('jar', ['cf', join(dist, 'CommunicationMod.jar'), '-C', commClasses, '.']);
  compile(javaFiles(join(root, 'mod/src')), modClasses, [classpath, join(dist, 'CommunicationMod.jar')].join(delimiter));
  run('jar', ['cf', join(dist, 'CorticoSts.jar'), '-C', modClasses, '.', '-C', join(root, 'mod/resources'), '.']);
  return paths;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build(process.argv[2] || process.env.CORTICO_STS_GAME_DIR);
}
