import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseMessage, STS_MAX_FRAME_BYTES, STS_PROTOCOL, type StsMessage, type StsSnapshot } from './protocol.ts';

export class StsBridge extends EventEmitter {
  private socket: Socket | null = null;
  private pending = new Map<string, { resolve: (value: StsMessage) => void; reject: (error: Error) => void; dispose: () => void }>();
  snapshot: StsSnapshot | null = null;
  get connected(): boolean { return this.socket !== null && !this.socket.destroyed && this.snapshot !== null; }

  async connect(port: number, token: string, timeoutMs: number): Promise<StsSnapshot> {
    this.close();
    if (token.length < 24) throw new Error('CORTICO_STS_TOKEN must contain at least 24 characters');
    const socket = createConnection({ host: '127.0.0.1', port });
    this.socket = socket;
    socket.setNoDelay(true); socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      try {
        for (;;) {
          const end = buffer.indexOf('\n');
          if (end === -1) break;
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (Buffer.byteLength(line) > STS_MAX_FRAME_BYTES) throw new Error('StS frame exceeds limit');
          this.receive(parseMessage(line));
        }
        if (Buffer.byteLength(buffer) > STS_MAX_FRAME_BYTES) throw new Error('StS frame exceeds limit');
      } catch (error) { socket.destroy(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', error => this.fail(socket, error));
    socket.on('close', () => this.fail(socket, new Error('StS sidecar disconnected; submitted action outcome may be unknown')));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('StS connection timed out')); }, timeoutMs);
        const cleanup = () => { clearTimeout(timer); socket.off('error', onError); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        socket.once('error', onError);
        socket.once('connect', () => { cleanup(); resolve(); });
      });
      const hello = await this.request({ type: 'hello', token }, timeoutMs);
      if (hello.type !== 'hello' || !hello.snapshot) throw new Error('StS handshake failed');
      this.snapshot = hello.snapshot;
      return hello.snapshot;
    } catch (error) { this.close(); throw error; }
  }

  request(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<StsMessage> {
    signal?.throwIfAborted();
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error('StS sidecar is not connected'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abandon = (reason: Error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); pending.dispose();
        if (payload.type === 'do' || payload.type === 'fallback') {
          socket.write(`${JSON.stringify({ protocol: STS_PROTOCOL, type: 'cancel', id: randomUUID(), requestId: id })}\n`);
        }
        reject(reason);
      };
      const timer = setTimeout(() => abandon(new Error(`StS ${String(payload.type)} timed out; observe before another action`)), timeoutMs);
      const abort = () => abandon(new Error('StS request aborted; submitted input cannot be undone'));
      const dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { resolve, reject, dispose });
      signal?.addEventListener('abort', abort, { once: true });
      socket.write(`${JSON.stringify({ ...payload, protocol: STS_PROTOCOL, id })}\n`, error => {
        if (error) abandon(error);
      });
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null; this.snapshot = null;
    for (const pending of this.pending.values()) { pending.dispose(); pending.reject(new Error('StS connection closed')); }
    this.pending.clear(); socket?.destroy();
  }

  private receive(message: StsMessage): void {
    if (message.snapshot) this.snapshot = message.snapshot;
    if (message.receipt) this.snapshot = message.receipt.snapshot;
    const pending = message.id ? this.pending.get(message.id) : undefined;
    if (pending && message.id) {
      this.pending.delete(message.id); pending.dispose();
      if (message.type === 'error') pending.reject(new Error(message.reason)); else pending.resolve(message);
    } else if (message.type === 'snapshot' && !message.id) this.emit('snapshot', message.snapshot);
  }

  private fail(socket: Socket, error: Error): void {
    if (this.socket !== socket) return;
    this.close(); this.emit('disconnect', error);
  }
}
