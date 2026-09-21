import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { StsConfigSection } from './config.ts';
import { StsBridge } from './bridge.ts';

export function launchGame(cfg: StsConfigSection, token: string, dataDir: string): ChildProcess {
  const java = cfg.javaFile || join(cfg.gameDir, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const mts = cfg.modTheSpireFile || [join(cfg.gameDir, 'ModTheSpire.jar'),
    resolve(cfg.gameDir, '../../workshop/content/646570/1605060445/ModTheSpire.jar')].find(existsSync);
  for (const file of [java, mts, join(cfg.gameDir, 'mods', 'CorticoSts.jar'), join(cfg.gameDir, 'mods', 'CommunicationMod.jar')]) {
    if (!file || !existsSync(file)) throw new Error(`Missing StS runtime file: ${file ?? 'ModTheSpire.jar'}; run pnpm install:mod <game directory>`);
  }
  mkdirSync(dataDir, { recursive: true });
  const output = openSync(join(dataDir, 'game.log'), 'a');
  try {
    const child = spawn(java, ['-jar', mts!, '--skip-launcher', '--skip-intro', '--mods', 'basemod,CommunicationMod,cortico-sts'], {
      cwd: cfg.gameDir, windowsHide: true, detached: true, stdio: ['ignore', output, output],
      env: { ...process.env, CORTICO_STS_TOKEN: token, CORTICO_STS_PORT: String(cfg.port) },
    });
    child.unref(); return child;
  } finally { closeSync(output); }
}

export async function connectGame(bridge: StsBridge, cfg: StsConfigSection, token: string,
  signal: AbortSignal, launched?: ChildProcess): Promise<void> {
  const deadline = Date.now() + cfg.connectTimeoutMs;
  let error: unknown;
  let launchError: Error | null = null;
  const failed = (err: Error) => { launchError = err; };
  launched?.once('error', failed);
  try {
    do {
      signal.throwIfAborted();
      if (launchError) throw launchError;
      if (launched?.exitCode != null) throw new Error(`StS exited with ${launched.exitCode}; inspect game.log`);
      try { await bridge.connect(cfg.port, token, Math.min(3000, deadline - Date.now())); return; }
      catch (err) { error = err; }
      await delay(Math.min(500, Math.max(1, deadline - Date.now())), undefined, { signal });
    } while (Date.now() < deadline);
    throw error;
  } finally { launched?.off('error', failed); }
}
