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
import { renderReceipt, renderSnapshot, screenName, stateRef } from './render.ts';

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
  private presented: StsSnapshot | null = null;
  private eventPending = false;
  private eventTicket = 0;
  private decisionAfterTurn = false;

  constructor(private readonly opts: StsWorldOptions) {
    this.bridge.on('snapshot', () => { this.queueState(); });
    this.bridge.on('disconnect', (error: Error) => {
      if (this.state !== 'online') return;
      this.state = 'error'; this.detail = error.message;
      void this.event('sts.connection', `游戏连接已断开：${error.message}。已提交动作的结果可能未确认，请先用 sts_observe 重连。`);
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
      this.state = 'online'; this.detail = ''; this.presented = null;
      this.queueState();
    } catch (error) {
      this.state = 'error'; this.detail = String(error); this.bridge.close(); throw error;
    }
  }
  async stop(): Promise<void> {
    this.state = 'offline'; this.stopSignal.abort(); this.bridge.close(); this.host = null; this.presented = null;
    this.decisionAfterTurn = false; this.eventPending = false; this.eventTicket++;
  }
  onHandoffEnded(): void { this.presented = null; this.queueState(); }
  onTurnEnded(): void {
    const pending = this.decisionAfterTurn;
    this.decisionAfterTurn = false;
    if (pending) this.queueState(true);
  }

  private async call(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    ctx.signal?.throwIfAborted();
    if (!this.host) throw new Error('StS World is not started');
    if (!this.bridge.connected) {
      await this.bridge.connect(this.opts.cfg.port, this.opts.token(), 3000); this.state = 'online'; this.detail = '';
    }
    if (name === 'sts_observe') {
      const result = await this.bridge.request({ type: 'observe' }, 5000, ctx.signal);
      if (!result.snapshot) throw new Error('Missing StS snapshot');
      this.presented = result.snapshot;
      return { text: renderSnapshot(result.snapshot, args.detail === 'full') };
    }
    if (name === 'sts_capture') {
      const result = await this.bridge.request({ type: 'capture' }, 10000, ctx.signal);
      if (!result.base64) throw new Error('Missing StS screenshot');
      return { text: '杀戮尖塔当前画面。', blobs: [{ bytes: Buffer.from(result.base64, 'base64'), mime: 'image/png', name: 'sts.png', fallbackText: '杀戮尖塔当前画面' }] };
    }
    validateActionArgs(args, name === 'sts_input');
    if (this.busy) throw new Error('A StS action is already in flight');
    const before = this.presented;
    if (!before || args.state !== stateRef(before) || args.state !== stateRef(this.bridge.snapshot!)) {
      const result = await this.bridge.request({ type: 'observe' }, 5000, ctx.signal);
      this.presented = result.snapshot!;
      return { text: `未执行：状态码已过期，请使用下面的状态与操作编号。\n${renderSnapshot(result.snapshot!)}`, failed: true };
    }
    const action = name === 'sts_do' ? before.actions[(args.action as number) - 1] : undefined;
    if (name === 'sts_do' && !action) return { text: `未执行：当前没有操作 ${args.action}。\n${renderSnapshot(before)}`, failed: true };
    this.busy = true;
    try {
      const { state: _state, action: _action, ...input } = args;
      const result = await this.bridge.request({ ...input, type: name === 'sts_do' ? 'do' : 'fallback',
        sessionId: before.sessionId, revision: before.revision, ...(action ? { actionId: action.id } : {}),
        timeoutMs: this.opts.cfg.actionTimeoutMs, cursorDurationMs: this.opts.cfg.cursorDurationMs,
      }, this.opts.cfg.actionTimeoutMs + 3000, ctx.signal);
      if (!result.receipt) throw new Error('Missing StS action receipt');
      if (result.receipt.outcome === 'executed') this.decisionAfterTurn = true;
      this.presented = result.receipt.snapshot;
      return { text: renderReceipt(result.receipt, before, action), ...(result.receipt.outcome !== 'executed' ? { failed: true as const } : {}) };
    } finally { this.busy = false; this.queueState(); }
  }
  private queueState(remind = false): void {
    const snapshot = this.bridge.snapshot;
    if (!this.host || !snapshot?.ready || this.busy || this.state !== 'online' || this.eventPending) return;
    if (!remind && this.presented && stateRef(snapshot) === stateRef(this.presented)) return;
    this.eventPending = true;
    const ticket = ++this.eventTicket;
    this.host.pushDeferred({ type: remind ? 'sts.decision' : 'sts.state', senderKey: 'sts',
      ...(remind ? {} : { tags: ['snapshot'] as const }),
      render: () => {
        if (ticket !== this.eventTicket) return null;
        this.eventPending = false;
        const latest = this.bridge.snapshot;
        if (!latest?.ready || this.busy || this.state !== 'online') return null;
        if (this.presented && stateRef(latest) === stateRef(this.presented)) {
          return remind ? `[StS] ${screenName(latest)}仍等待操作；沿用上一份状态 ${stateRef(latest)}。` : null;
        }
        this.presented = latest;
        return renderSnapshot(latest);
      },
    }, { trigger: 'flush' });
  }
  private async event(type: string, text: string): Promise<void> {
    try {
      await this.host?.pushEvent({ type, source: 'sts', senderKey: 'sts', ts: nowIso(this.opts.timezone), text }, { trigger: 'flush' });
    } catch (error) { this.host?.log.warn('sts.event', String(error)); }
  }
}
