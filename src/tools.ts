import type { ToolDef } from 'cortico/core/types.ts';

const binding = {
  state: { type: 'string', description: '最近快照标题中的状态码，原样复制。' },
};
export const STS_TOOL_DECLS: Omit<ToolDef, 'handler'>[] = [
  {
    name: 'sts_observe', description: '读取当前局面和操作编号。已有事件或回执时直接使用；状态不清楚时重读。', tags: ['read', 'snapshot'],
    parameters: { type: 'object', properties: { detail: { type: 'string', enum: ['decision', 'full'], description: '默认返回完整的当前决策；full 另含主牌组、各牌堆内容及全图。' } }, additionalProperties: false },
  },
  {
    name: 'sts_do', description: '使用最新状态码和操作编号，执行一个动作并等待结算。回执报告结果与变化；每轮只调用一次。',
    tags: ['act'], barrierAfter: true,
    parameters: { type: 'object', properties: { ...binding, action: { type: 'integer', minimum: 1, description: '快照中标出的操作编号。出牌编号可位于手牌行，药水编号可位于药水行。' } }, required: ['state', 'action'], additionalProperties: false },
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
    }, required: ['state', 'kind'], additionalProperties: false },
  },
];

export function validateActionArgs(args: Record<string, unknown>, fallback = false): void {
  if (typeof args.state !== 'string' || !args.state) throw new Error('请复制最近快照的状态码 state');
  if (!fallback) {
    if (!Number.isSafeInteger(args.action) || (args.action as number) < 1) throw new Error('action 必须是快照中的操作编号');
  } else if (args.kind === 'click') {
    if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || (args.x as number) < 0 || (args.x as number) > 1920
      || (args.y as number) < 0 || (args.y as number) > 1080 || !['left', 'right'].includes(String(args.button))) throw new Error('Invalid game click');
  } else if (args.kind !== 'key' || typeof args.key !== 'string') throw new Error('A fallback key or click is required');
}
