import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsonlEventStore } from 'cortico/core/event-store.ts';
import { nullLogger } from 'cortico/core/util.ts';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { STS_DEFAULTS } from '../src/config.ts';
import { StsWorld } from '../src/world.ts';
import { Sidecar, TOKEN } from './sidecar.ts';
import { stateRef } from '../src/render.ts';

const resources: Array<{ world: StsWorld; server: Sidecar }> = [];
afterEach(async () => { for (const r of resources.splice(0)) { await r.world.stop(); await r.server.stop(); } });
async function fixture(deliverInitial = true) {
  const server = new Sidecar(), port = await server.start();
  mkdirSync(resolve('scratch/tests'), { recursive: true });
  const dataDir = mkdtempSync(resolve('scratch/tests/world-'));
  const store = new JsonlEventStore({ dataDir, run: 'test' });
  const deferred: Parameters<WorldHost['pushDeferred']>[0][] = [];
  const host: WorldHost = {
    store, log: nullLogger(), blob: () => null, reportUsage() {}, pushDeferred: e => { deferred.push(e); },
    modelFacts: { model: () => 'test', accepts: () => false, contextWindow: () => 128000 },
    drainPendingEvents: async () => [],
    pushEvent: async event => { const { blobs, ...plain } = event; return store.append({ ...plain, origin: event.origin ?? 'external' }); },
  };
  const world = new StsWorld({ cfg: { ...STS_DEFAULTS, port }, timezone: 'UTC', dataDir,
    token: () => TOKEN, storeToken: () => { throw new Error('Unexpected token update'); } });
  resources.push({ server, world });
  await world.start(host);
  const deliver = async () => {
    for (const e of deferred.splice(0)) {
      const rendered = await e.render();
      if (rendered !== null) await host.pushEvent({ type: e.type, source: 'sts', senderKey: e.senderKey,
        ts: new Date().toISOString(), tags: e.tags, text: typeof rendered === 'string' ? rendered : rendered.text });
    }
  };
  if (deliverInitial) await deliver();
  const ctx: ToolCallContext = { role: 'main', log: nullLogger() };
  const call = (name: string, args: Record<string, unknown> = {}) => world.tools().find(t => t.name === name)!.handler(args, ctx);
  return { world, server, store, call, deliver, deferred };
}
describe('StS World', () => {
  it('archives external decisions and returns action state without duplicate wakeups', async () => {
    const { server, store, call, deliver, deferred } = await fixture();
    expect(store.latestCursor()).toBe(1);
    expect(store.get(1)?.type).toBe('sts.state');
    expect(store.get(1)?.origin).toBe('external');
    const initial = structuredClone(server.state);
    const receipt = await call('sts_do', { state: stateRef(initial), action: 1 });
    expect(typeof receipt === 'string' ? receipt : receipt.text).toContain('已执行');
    server.send({ type: 'snapshot', snapshot: server.state });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(store.latestCursor()).toBe(1);
    server.state.revision++; server.send({ type: 'snapshot', snapshot: server.state });
    await vi.waitFor(() => expect(deferred).toHaveLength(1));
    await deliver(); expect(store.latestCursor()).toBe(2);
  });
  it('serializes actions and rejects a second mutation while one is pending', async () => {
    const { server, call } = await fixture(); server.hold = true;
    const args = { state: stateRef(server.state), action: 1 };
    const first = call('sts_do', args);
    const rejected = expect(first).rejects.toThrow('closed');
    await expect(call('sts_do', args)).rejects.toThrow('already in flight');
    server.socket!.destroy(); await rejected;
  });
  it('records a connection failure, can observe after reconnect, and stops without closing the game', async () => {
    const { world, server, store, call, deliver } = await fixture();
    server.socket!.destroy();
    await vi.waitFor(() => expect(store.get(2)?.type).toBe('sts.connection'));
    await call('sts_observe');
    expect(world.console().lamps?.[0].state).toBe('online');
    await world.stop();
    expect(server.mutations).toBe(0);
    await expect(call('sts_observe')).rejects.toThrow('not started');
  });
  it('emits one decision at the turn boundary after an executed action and stays idle without further actions', async () => {
    const { world, server, store, call, deliver } = await fixture();
    world.onTurnEnded(); expect(store.latestCursor()).toBe(1);
    await call('sts_do', { state: stateRef(server.state), action: 1 });
    world.onTurnEnded();
    await deliver();
    expect(store.get(2)?.type).toBe('sts.decision');
    expect(store.get(2)!.text).toContain('仍等待操作');
    expect(store.get(2)!.text.length).toBeLessThan(80);
    world.onTurnEnded(); expect(store.latestCursor()).toBe(2);
  });
  it('coalesces queued events into the latest state and drops a snapshot already read by a tool', async () => {
    const { server, store, call, deliver, deferred } = await fixture(false);
    for (const hp of [55, 50, 45]) {
      server.state.revision++; server.state.game!.current_hp = hp;
      server.send({ type: 'snapshot', snapshot: server.state });
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(deferred).toHaveLength(1);
    await deliver();
    expect(store.get(1)!.text).toContain('生命 45/');
    expect(store.get(1)!.tags).toContain('snapshot');
    server.state.revision++; server.send({ type: 'snapshot', snapshot: server.state });
    await vi.waitFor(() => expect(deferred).toHaveLength(1));
    await call('sts_observe'); await deliver();
    expect(store.latestCursor()).toBe(1);
  });
  it('does not rebind an old action number to a changed state or a restarted game', async () => {
    const { server, call } = await fixture();
    const original = { state: stateRef(server.state), action: 1 };
    server.state.revision++;
    server.state.actions = [{ id: 'end_turn', kind: 'end_turn', label: '结束回合' }];
    const rejected = await call('sts_do', original);
    expect(rejected).toMatchObject({ failed: true }); expect(server.mutations).toBe(0);
    const next = { state: stateRef(server.state), action: 1 };
    server.socket!.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    server.state.sessionId = 'a-new-game';
    expect(await call('sts_do', next)).toMatchObject({ failed: true });
    expect(server.mutations).toBe(0);
    expect(await call('sts_do', { state: stateRef(server.state), action: 1 })).toMatchObject({ text: expect.stringContaining('已执行') });
    expect(server.mutations).toBe(1);
  });
  it('refreshes a complete decision after handoff and invalidates queued events on stop', async () => {
    const { world, server, store, call, deliver, deferred } = await fixture();
    await call('sts_do', { state: stateRef(server.state), action: 1 });
    world.onHandoffEnded(); await deliver();
    expect(store.get(2)!.text).toContain('生命');
    expect(store.get(2)!.text).not.toContain(' · 变化');
    world.onHandoffEnded(); expect(deferred).toHaveLength(1);
    await world.stop(); await deliver(); expect(store.latestCursor()).toBe(2);
  });
});
