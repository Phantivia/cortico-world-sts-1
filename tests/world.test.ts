import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsonlEventStore } from 'cortico/core/event-store.ts';
import { nullLogger } from 'cortico/core/util.ts';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { STS_DEFAULTS } from '../src/config.ts';
import { StsWorld } from '../src/world.ts';
import { Sidecar, TOKEN } from './sidecar.ts';

const resources: Array<{ world: StsWorld; server: Sidecar }> = [];
afterEach(async () => { for (const r of resources.splice(0)) { await r.world.stop(); await r.server.stop(); } });
async function fixture() {
  const server = new Sidecar(), port = await server.start();
  mkdirSync(resolve('scratch/tests'), { recursive: true });
  const dataDir = mkdtempSync(resolve('scratch/tests/world-'));
  const store = new JsonlEventStore({ dataDir, run: 'test' });
  const host: WorldHost = {
    store, log: nullLogger(), blob: () => null, reportUsage() {}, pushDeferred() {},
    modelFacts: { model: () => 'test', accepts: () => false, contextWindow: () => 128000 },
    drainPendingEvents: async () => [],
    pushEvent: async event => { const { blobs, ...plain } = event; return store.append({ ...plain, origin: event.origin ?? 'external' }); },
  };
  const world = new StsWorld({ cfg: { ...STS_DEFAULTS, port }, timezone: 'UTC', dataDir,
    token: () => TOKEN, storeToken: () => { throw new Error('Unexpected token update'); } });
  resources.push({ server, world });
  await world.start(host);
  const ctx: ToolCallContext = { role: 'main', log: nullLogger() };
  const call = (name: string, args: Record<string, unknown> = {}) => world.tools().find(t => t.name === name)!.handler(args, ctx);
  return { world, server, store, call };
}
describe('StS World', () => {
  it('archives external decisions and returns action state without duplicate wakeups', async () => {
    const { server, store, call } = await fixture();
    expect(store.latestCursor()).toBe(1);
    expect(store.get(1)?.type).toBe('sts.state');
    expect(store.get(1)?.origin).toBe('external');
    const initial = structuredClone(server.state);
    const receipt = await call('sts_do', { sessionId: initial.sessionId, revision: initial.revision, actionId: initial.actions[0].id });
    expect(JSON.parse(typeof receipt === 'string' ? receipt : receipt.text).outcome).toBe('executed');
    server.send({ type: 'snapshot', snapshot: server.state });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(store.latestCursor()).toBe(1);
    server.state.revision++; server.send({ type: 'snapshot', snapshot: server.state });
    await vi.waitFor(() => expect(store.latestCursor()).toBe(2));
  });
  it('serializes actions and rejects a second mutation while one is pending', async () => {
    const { server, call } = await fixture(); server.hold = true;
    const args = { sessionId: server.state.sessionId, revision: server.state.revision, actionId: server.state.actions[0].id };
    const first = call('sts_do', args);
    const rejected = expect(first).rejects.toThrow('closed');
    await expect(call('sts_do', args)).rejects.toThrow('already in flight');
    server.socket!.destroy(); await rejected;
  });
  it('records a connection failure, can observe after reconnect, and stops without closing the game', async () => {
    const { world, server, store, call } = await fixture();
    server.socket!.destroy();
    await vi.waitFor(() => expect(store.get(2)?.type).toBe('sts.connection'));
    await call('sts_observe');
    expect(world.console().lamps?.[0].state).toBe('online');
    await world.stop();
    expect(server.mutations).toBe(0);
    await expect(call('sts_observe')).rejects.toThrow('not started');
  });
});
