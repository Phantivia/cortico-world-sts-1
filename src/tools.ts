import type { ToolDef } from 'cortico/core/types.ts';

const binding = {
  sessionId: { type: 'string', description: '最近快照的 sessionId。' },
  revision: { type: 'integer', minimum: 0, description: '最近快照的 revision。' },
};
export const STS_TOOL_DECLS: Omit<ToolDef, 'handler'>[] = [
  {
    name: 'sts_observe', description: '读取杀戮尖塔当前可见状态及原子动作；不执行游戏动作。', tags: ['read'],
    parameters: { type: 'object', properties: { detail: { type: 'string', enum: ['decision', 'full'], description: 'full 包含完整地图与主牌组；默认 decision 返回当前决策所需状态。' } }, additionalProperties: false },
  },
  {
    name: 'sts_do', description: '从最新快照 actions 选择一个 actionId 执行，等待结算并返回下一快照。每次只执行一个原子动作。',
    tags: ['act'], barrierAfter: true,
    parameters: { type: 'object', properties: { ...binding, actionId: { type: 'string' } }, required: ['sessionId', 'revision', 'actionId'], additionalProperties: false },
  },
  {
    name: 'sts_capture', description: '读取游戏渲染画面，含内部光标，返回 PNG。', tags: ['read'],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'sts_input', description: '语义动作未覆盖界面时的兜底输入。kind=click 使用 1920×1080 左上原点坐标和 left/right；kind=key 使用游戏按键名。执行后读取回执确认状态。',
    tags: ['act'], barrierAfter: true,
    parameters: { type: 'object', properties: { ...binding,
      kind: { type: 'string', enum: ['click', 'key'] },
      x: { type: 'integer', minimum: 0, maximum: 1920 }, y: { type: 'integer', minimum: 0, maximum: 1080 },
      button: { type: 'string', enum: ['left', 'right'] },
      key: { type: 'string', enum: ['confirm', 'cancel', 'map', 'deck', 'draw_pile', 'discard_pile', 'exhaust_pile', 'end_turn', 'up', 'down', 'left', 'right', 'drop_card', ...Array.from({ length: 10 }, (_, i) => `card_${i + 1}`)] },
    }, required: ['sessionId', 'revision', 'kind'], additionalProperties: false },
  },
];

export function validateActionArgs(args: Record<string, unknown>, fallback = false): void {
  if (typeof args.sessionId !== 'string' || !args.sessionId || !Number.isSafeInteger(args.revision) || (args.revision as number) < 0) throw new Error('sessionId and revision must come from a current snapshot');
  if (!fallback) {
    if (typeof args.actionId !== 'string' || !args.actionId) throw new Error('actionId is required');
  } else if (args.kind === 'click') {
    if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || (args.x as number) < 0 || (args.x as number) > 1920
      || (args.y as number) < 0 || (args.y as number) > 1080 || !['left', 'right'].includes(String(args.button))) throw new Error('Invalid game click');
  } else if (args.kind !== 'key' || typeof args.key !== 'string') throw new Error('A fallback key or click is required');
}
