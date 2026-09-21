export const STS_PROTOCOL = 1;
export const STS_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export interface StsAction {
  id: string;
  kind: string;
  label: string;
  details?: Record<string, unknown>;
}

export interface StsSnapshot {
  sessionId: string;
  revision: number;
  ready: boolean;
  screen: string;
  game: Record<string, unknown> | null;
  actions: StsAction[];
}

export interface StsReceipt {
  outcome: 'executed' | 'rejected' | 'unknown';
  reason?: string;
  actionId?: string;
  snapshot: StsSnapshot;
}

export interface StsMessage {
  protocol: number;
  type: 'hello' | 'snapshot' | 'result' | 'frame' | 'error';
  id?: string;
  snapshot?: StsSnapshot;
  receipt?: StsReceipt;
  base64?: string;
  reason?: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateSnapshot(value: unknown): asserts value is StsSnapshot {
  if (!object(value) || typeof value.sessionId !== 'string' || !value.sessionId
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || typeof value.ready !== 'boolean' || typeof value.screen !== 'string'
    || !(value.game === null || object(value.game)) || !Array.isArray(value.actions)
    || value.actions.some(a => !object(a) || typeof a.id !== 'string' || !a.id
      || typeof a.kind !== 'string' || typeof a.label !== 'string')
    || new Set(value.actions.map(a => a.id)).size !== value.actions.length) {
    throw new Error('Invalid StS snapshot');
  }
}

export function parseMessage(line: string): StsMessage {
  const value: unknown = JSON.parse(line);
  if (!object(value) || value.protocol !== STS_PROTOCOL
    || !['hello', 'snapshot', 'result', 'frame', 'error'].includes(String(value.type))) {
    throw new Error('Invalid StS sidecar protocol');
  }
  if (value.type === 'snapshot' || value.type === 'hello') validateSnapshot(value.snapshot);
  if (value.type !== 'snapshot' && (typeof value.id !== 'string' || !value.id)) {
    throw new Error('Missing StS request ID');
  }
  if (value.type === 'result') {
    if (!object(value.receipt) || !['executed', 'rejected', 'unknown'].includes(String(value.receipt.outcome))) {
      throw new Error('Invalid StS receipt');
    }
    validateSnapshot(value.receipt.snapshot);
  }
  if (value.type === 'frame' && (typeof value.base64 !== 'string'
    || !value.base64.startsWith('iVBORw0KGgo'))) throw new Error('Invalid StS PNG');
  if (value.type === 'error' && typeof value.reason !== 'string') throw new Error('Missing StS error');
  return value as unknown as StsMessage;
}
