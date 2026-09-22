import type { WorldDefinition } from 'cortico/world.ts';
import { STS_DEFAULTS, type StsConfigSection } from './config.ts';
import { StsWorld } from './world.ts';

export const STS: WorldDefinition<StsConfigSection> = {
  id: 'sts-1', label: '杀戮尖塔', defaults: () => structuredClone(STS_DEFAULTS),
  create: ctx => new StsWorld({ cfg: ctx.cfg, timezone: ctx.timezone, dataDir: ctx.dataDir,
    token: () => ctx.secret('CORTICO_STS_TOKEN'), storeToken: value => ctx.storeSecret('CORTICO_STS_TOKEN', value) }),
};
