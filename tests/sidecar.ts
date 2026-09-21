import { createServer, type Socket } from 'node:net';
import type { StsSnapshot } from '../src/protocol.ts';

export const TOKEN = 'test-sidecar-token-with-enough-entropy';
export class Sidecar {
  state: StsSnapshot = { sessionId: 'test-session', revision: 1, ready: true, screen: 'COMBAT',
    game: { current_hp: 60, combat_state: { player: { energy: 3 }, hand: [{ uuid: 'card-a', name: '攻击 🗡' }] } },
    actions: [{ id: 'play:card-a:0', kind: 'play', label: '攻击 🗡 → 敌人' }] };
  socket: Socket | null = null;
  requests: Record<string, unknown>[] = [];
  mutations = 0;
  hold = false;
  fragmented = false;
  private server = createServer(socket => {
    this.socket = socket;
    socket.setEncoding('utf8');
    let buffer = '', authenticated = false;
    socket.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) return;
        const request = JSON.parse(buffer.slice(0, end)) as Record<string, unknown>;
        buffer = buffer.slice(end + 1); this.requests.push(request);
        if (request.type === 'hello') {
          if (request.token !== TOKEN) { socket.destroy(); return; }
          authenticated = true; this.send({ type: 'hello', id: request.id, snapshot: this.state });
        } else if (!authenticated) socket.destroy();
        else if (request.type === 'observe' || request.type === 'cancel') this.send({ type: 'snapshot', id: request.id, snapshot: this.state });
        else if (request.type === 'do') {
          if (this.hold) continue;
          if (request.sessionId !== this.state.sessionId || request.revision !== this.state.revision
            || !this.state.actions.some(a => a.id === request.actionId)) {
            this.send({ type: 'result', id: request.id, receipt: { outcome: 'rejected', reason: 'Stale snapshot', snapshot: this.state } });
          } else {
            this.mutations++; this.state.revision++;
            this.state.actions = [{ id: 'end_turn', kind: 'end_turn', label: '结束回合' }];
            this.state.game = { current_hp: 60, combat_state: { player: { energy: 2 }, hand: [] } };
            this.send({ type: 'result', id: request.id, receipt: { outcome: 'executed', actionId: request.actionId, snapshot: this.state } });
          }
        }
      }
    });
  });
  async start(): Promise<number> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return (this.server.address() as { port: number }).port;
  }
  send(payload: Record<string, unknown>): void {
    const bytes = Buffer.from(`${JSON.stringify({ protocol: 1, ...payload })}\n`);
    if (!this.fragmented) { this.socket?.write(bytes); return; }
    for (const byte of bytes) this.socket?.write(Buffer.from([byte]));
  }
  async stop(): Promise<void> {
    this.socket?.destroy(); await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}
