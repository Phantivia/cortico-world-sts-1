import { describe, expect, it } from 'vitest';
import { parseMessage, validateSnapshot } from '../src/protocol.ts';
import { validateActionArgs } from '../src/tools.ts';
import { STS } from '../src/definition.ts';
import { STS_DEFAULTS } from '../src/config.ts';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Sidecar } from './sidecar.ts';

describe('StS contracts', () => {
  it('mounts through the extension contract with its declared defaults', async () => {
    const scratchDir = resolve('scratch/tests/mount'); mkdirSync(scratchDir, { recursive: true });
    expect((await dryMountWorld(STS, { scratchDir })).failures).toEqual([]);
    expect(STS.defaults()).toEqual(STS_DEFAULTS);
    const config = STS.defaults(); config.port++;
    expect(STS.defaults().port).toBe(STS_DEFAULTS.port);
  });
  it('rejects duplicate action identities and invalid revisions', () => {
    const state = new Sidecar().state;
    state.actions.push(state.actions[0]); expect(() => validateSnapshot(state)).toThrow();
    state.actions.pop(); state.revision = NaN; expect(() => validateSnapshot(state)).toThrow();
  });
  it('rejects receipts without an outcome and a snapshot', () => {
    expect(() => parseMessage(JSON.stringify({ protocol: 1, type: 'result', id: 'a', receipt: { outcome: 'accepted' } }))).toThrow();
  });
  it('requires explicit bounded coordinates for fallback clicks', () => {
    const base = { state: 'current-state', kind: 'click', x: 4, y: 5, button: 'left' };
    expect(() => validateActionArgs(base, true)).not.toThrow();
    expect(() => validateActionArgs({ ...base, x: 1921 }, true)).toThrow();
    expect(() => validateActionArgs({ ...base, button: undefined }, true)).toThrow();
  });
  it('requires a state reference and a positive integer action number', () => {
    expect(() => validateActionArgs({ state: 'current-state', action: 1 })).not.toThrow();
    for (const action of [0, -1, 1.5, '1', undefined]) expect(() => validateActionArgs({ state: 'current-state', action })).toThrow();
    expect(() => validateActionArgs({ action: 1 })).toThrow();
  });
});
