import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { StsBridge } from '../src/bridge.ts';
import { Sidecar, TOKEN } from './sidecar.ts';

const bridges: StsBridge[] = [], servers: Sidecar[] = [];
afterEach(async () => { for (const bridge of bridges.splice(0)) bridge.close(); for (const server of servers.splice(0)) await server.stop(); });
async function connect() {
  const server = new Sidecar(); servers.push(server);
  const port = await server.start();
  const bridge = new StsBridge(); bridges.push(bridge);
  return { server, bridge, port };
}
describe('StS sidecar transport', () => {
  it('preserves UTF-8 across fragmented frames and correlates replies with requests', async () => {
    const { server, bridge, port } = await connect(); server.fragmented = true;
    const state = await bridge.connect(port, TOKEN, 1000);
    expect(state.actions[0].label).toContain('🗡');
    const replies = await Promise.all([bridge.request({ type: 'observe' }, 1000), bridge.request({ type: 'observe' }, 1000)]);
    expect(replies[0].id).not.toBe(replies[1].id);
    expect(replies.map(r => r.snapshot)).toEqual([server.state, server.state]);
  });
  it('executes once and rejects a stale snapshot without another mutation', async () => {
    const { server, bridge, port } = await connect();
    const initial = structuredClone(await bridge.connect(port, TOKEN, 1000));
    const command = { type: 'do', sessionId: initial.sessionId, revision: initial.revision, actionId: initial.actions[0].id };
    const first = await bridge.request(command, 1000);
    const second = await bridge.request(command, 1000);
    expect(first.receipt?.outcome).toBe('executed');
    expect(first.receipt?.snapshot.game).toMatchObject({ combat_state: { player: { energy: 2 } } });
    expect(second.receipt?.outcome).toBe('rejected');
    expect(server.mutations).toBe(1);
  });
  it('aborts before sending input when the signal is already cancelled', async () => {
    const { server, bridge, port } = await connect(); await bridge.connect(port, TOKEN, 1000);
    const signal = AbortSignal.abort();
    expect(() => bridge.request({ type: 'do' }, 1000, signal)).toThrow();
    expect(server.requests.map(r => r.type)).toEqual(['hello']);
  });
  it('times out with a cancellation request and does not replay the action', async () => {
    const { server, bridge, port } = await connect(); await bridge.connect(port, TOKEN, 1000); server.hold = true;
    await expect(bridge.request({ type: 'do' }, 20)).rejects.toThrow('observe');
    await delay(30);
    expect(server.requests.filter(r => r.type === 'do')).toHaveLength(1);
    expect(server.requests.filter(r => r.type === 'cancel')).toHaveLength(1);
  });
  it('rejects pending requests on disconnect and re-authenticates on reconnect', async () => {
    const { server, bridge, port } = await connect(); await bridge.connect(port, TOKEN, 1000); server.hold = true;
    const received = once(server.socket!, 'data');
    const waiting = bridge.request({ type: 'do' }, 1000);
    const rejected = expect(waiting).rejects.toThrow('closed');
    await received; server.socket!.destroy(); await rejected;
    expect(bridge.connected).toBe(false);
    await bridge.connect(port, TOKEN, 1000);
    expect(bridge.connected).toBe(true);
    expect(server.requests.filter(r => r.type === 'do')).toHaveLength(1);
  });
  it('closes a malformed stream instead of treating it as state', async () => {
    const { server, bridge, port } = await connect(); await bridge.connect(port, TOKEN, 1000);
    const disconnected = once(bridge, 'disconnect');
    server.socket!.write('{"protocol":99,"type":"snapshot"}\n');
    expect((await disconnected)[0].message).toContain('protocol');
    expect(bridge.snapshot).toBeNull();
  });
  it('does not accept an unauthenticated session', async () => {
    const { bridge, port } = await connect();
    await expect(bridge.connect(port, 'incorrect-token-that-is-long-enough', 1000)).rejects.toThrow();
    expect(bridge.connected).toBe(false);
  });
});
