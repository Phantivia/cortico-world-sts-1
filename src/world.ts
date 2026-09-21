import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolCallContext, ToolDef, ToolOutcome, World, WorldConsoleDecl, WorldHost } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { STS_CONFIG_GROUP, type StsConfigSection } from './config.ts';
import { StsBridge } from './bridge.ts';
import { STS_TOOL_DECLS, validateActionArgs } from './tools.ts';
import { connectGame, launchGame } from './runtime.ts';
import type { StsSnapshot } from './protocol.ts';
import { renderSnapshot } from './render.ts';

export interface StsWorldOptions {
  cfg: StsConfigSection;
  timezone: string;
  dataDir: string;
  token(): string;
  storeToken(value: string): void;
}

export class StsWorld implements World {
  readonly id = 'sts';
  private bridge = new StsBridge();
  private host: WorldHost | null = null;
  private stopSignal = new AbortController();
  private busy = false;
  private state: 'offline' | 'loading' | 'online' | 'error' = 'offline';
  private detail = '';
  private published = '';

  constructor(private readonly opts: StsWorldOptions) {
    this.bridge.on('snapshot', (snapshot: StsSnapshot) => { void this.publish(snapshot); });
    this.bridge.on('disconnect', (error: Error) => {
      if (this.state !== 'online') return;
      this.state = 'error'; this.detail = error.message;
      void this.event('sts.connection', error.message);
    });
  }
  envPromptVars(): Record<string, string> { return {}; }
  tools(): ToolDef[] { return STS_TOOL_DECLS.map(decl => ({ ...decl, handler: (args, ctx) => this.call(decl.name, args, ctx) })); }
  console(): WorldConsoleDecl {
    return {
      lamps: [{ label: 'Sidecar', state: this.state, hint: this.detail || undefined }],
      badges: [{ label: '界面', value: this.bridge.snapshot?.screen ?? '—' }],
      config: [STS_CONFIG_GROUP],
      promptDocs: [{ key: 'worlds.sts.envPrompt', title: '杀戮尖塔 · 环境提示词', description: '观察与动作回执的含义。',
        path: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), role: 'envPrompt' }],
    };
  }
  async start(host: WorldHost): Promise<void> {
    this.host = host; this.stopSignal = new AbortController(); this.state = 'loading';
    let token = this.opts.token();
    if (!token && this.opts.cfg.launch) { token = randomBytes(32).toString('hex'); this.opts.storeToken(token); }
    try {
      if (token.length < 24) throw new Error('Set CORTICO_STS_TOKEN in the deployment .env and game environment, or enable game launch');
      try { await this.bridge.connect(this.opts.cfg.port, token, 1000); }
      catch (error) {
        if (this.opts.cfg.launch && (error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error;
        const game = this.opts.cfg.launch ? launchGame(this.opts.cfg, token, join(this.opts.dataDir, 'sts')) : undefined;
        await connectGame(this.bridge, this.opts.cfg, token, this.stopSignal.signal, game);
      }
      this.state = 'online'; this.detail = ''; this.published = '';
      if (this.bridge.snapshot) await this.publish(this.bridge.snapshot);
    } catch (error) {
      this.state = 'error'; this.detail = String(error); this.bridge.close(); throw error;
    }
  }
  async stop(): Promise<void> {
    this.state = 'offline'; this.stopSignal.abort(); this.bridge.close(); this.host = null; this.published = '';
  }
  onHandoffEnded(): void { this.published = ''; if (this.bridge.snapshot) void this.publish(this.bridge.snapshot); }

  private async call(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    ctx.signal?.throwIfAborted();
    if (!this.host) throw new Error('StS World is not started');
    if (!this.bridge.connected) {
      await this.bridge.connect(this.opts.cfg.port, this.opts.token(), 3000); this.state = 'online'; this.detail = '';
    }
    if (name === 'sts_observe') {
      const result = await this.bridge.request({ type: 'observe' }, 5000, ctx.signal);
      if (!result.snapshot) throw new Error('Missing StS snapshot');
      return { text: JSON.stringify(renderSnapshot(result.snapshot, args.detail === 'full')) };
    }
    if (name === 'sts_capture') {
      const result = await this.bridge.request({ type: 'capture' }, 10000, ctx.signal);
      if (!result.base64) throw new Error('Missing StS screenshot');
      return { text: '杀戮尖塔当前画面。', blobs: [{ bytes: Buffer.from(result.base64, 'base64'), mime: 'image/png', name: 'sts.png', fallbackText: '杀戮尖塔当前画面' }] };
    }
    validateActionArgs(args, name === 'sts_input');
    if (this.busy) throw new Error('A StS action is already in flight');
    this.busy = true;
    try {
      const result = await this.bridge.request({ ...args, type: name === 'sts_do' ? 'do' : 'fallback',
        timeoutMs: this.opts.cfg.actionTimeoutMs, cursorDurationMs: this.opts.cfg.cursorDurationMs,
      }, this.opts.cfg.actionTimeoutMs + 3000, ctx.signal);
      if (!result.receipt) throw new Error('Missing StS action receipt');
      this.published = `${result.receipt.snapshot.sessionId}:${result.receipt.snapshot.revision}`;
      return { text: JSON.stringify({ ...result.receipt, snapshot: renderSnapshot(result.receipt.snapshot) }), ...(result.receipt.outcome !== 'executed' ? { failed: true as const } : {}) };
    } finally { this.busy = false; }
  }
  private async publish(snapshot: StsSnapshot): Promise<void> {
    const key = `${snapshot.sessionId}:${snapshot.revision}`;
    if (!snapshot.ready || this.busy || this.state !== 'online' || key === this.published) return;
    this.published = key;
    await this.event('sts.state', JSON.stringify(renderSnapshot(snapshot)));
  }
  private async event(type: string, text: string): Promise<void> {
    try {
      await this.host?.pushEvent({ type, source: 'sts', senderKey: 'sts', ts: nowIso(this.opts.timezone), text }, { trigger: 'flush' });
    } catch (error) { this.host?.log.warn('sts.event', String(error)); }
  }
}
