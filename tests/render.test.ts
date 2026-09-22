import { describe, expect, it } from 'vitest';
import { renderReceipt, renderSnapshot, stateRef } from '../src/render.ts';
import type { StsSnapshot } from '../src/protocol.ts';

function combat(): StsSnapshot {
  const card = { uuid: 'card-a', name: '试验攻击', cost: 1, description: '造成 6 点伤害。', target: 'ENEMY', damage: 6 };
  return { sessionId: 'game-session', revision: 1, ready: true, screen: 'COMBAT', game: {
    act: 1, floor: 4, current_hp: 60, max_hp: 80, gold: 30, class: 'IRONCLAD', ascension_level: 0,
    keys: { ruby: false }, relics: [{ id: 'relic', name: '试验遗物', counter: -1, description: '战斗结束回复生命。' }],
    potions: [{ id: 'potion', name: '试验药水', description: '造成 20 点伤害。' }, { id: 'Potion Slot' }],
    deck: [card, { ...card, uuid: 'card-b' }], map: [{ x: 1, y: 0, symbol: 'M', children: [{ x: 2, y: 1 }] }],
    combat_state: { turn: 2, player: { energy: 3, block: 5, powers: [], orbs: [], stance: 'Neutral' },
      monsters: [0, 1].map(index => ({ index, name: '试验敌人', current_hp: 12, max_hp: 20, block: 0,
        intent: 'ATTACK', move_adjusted_damage: 4, move_hits: 2, powers: [] })),
      hand: [card], draw_pile: [card], discard_pile: [], exhaust_pile: [],
    },
  }, actions: [
    { id: 'play:card-a:0', kind: 'play', label: '试验攻击 → 试验敌人 [0]', details: card },
    { id: 'play:card-a:1', kind: 'play', label: '试验攻击 → 试验敌人 [1]', details: card },
    { id: 'discard_potion:0', kind: 'discard_potion', label: '丢弃试验药水' },
    { id: 'use_potion:0:1', kind: 'use_potion', label: '使用试验药水' },
    { id: 'end_turn', kind: 'end_turn', label: '结束回合' },
  ] };
}

describe('semantic StS observations', () => {
  it('renders each playable card once with all targets and keeps native identifiers off the public surface', () => {
    const s = combat(), rendered = renderSnapshot(s);
    expect(rendered).toContain('出牌 1→敌0、2→敌1');
    expect(rendered.match(/造成 6 点伤害/g)).toHaveLength(1);
    expect(rendered).toContain('攻击 4×2');
    expect(rendered).toContain('3 丢弃、4 使用→敌1');
    expect(rendered).toContain('5 结束回合');
    expect(rendered).toContain('牌堆：抽 1／弃 0／消耗 0');
    for (const field of ['card-a', 'game-session', 'sessionId', 'actions', 'target', 'is_playable', 'false']) expect(rendered).not.toContain(field);
    expect(rendered.length).toBeLessThan(JSON.stringify(s).length / 3);
  });
  it('keeps deck multiplicity, unordered piles and map connections available on explicit full observation', () => {
    const s = combat();
    expect(renderSnapshot(s)).not.toContain('牌组');
    expect(renderSnapshot(s)).not.toContain('路线');
    const full = renderSnapshot(s, true);
    expect(full).toContain('牌组 2张：2×试验攻击');
    expect(full).toContain('抽牌堆（无序）');
    expect(full).toContain('0: 1战斗→2');
  });
  it('groups identical hand cards while retaining every legal card and target action number', () => {
    const s = combat(), hand = (s.game!.combat_state as { hand: Record<string, unknown>[] }).hand;
    const second = { ...hand[0], uuid: 'card-b' }; hand.push(second);
    s.actions.splice(2, 0, ...[0, 1].map(target => ({ id: `play:card-b:${target}`, kind: 'play', label: '试验攻击', details: second })));
    const text = renderSnapshot(s);
    expect(text.match(/造成 6 点伤害/g)).toHaveLength(1);
    expect(text).toContain('2×试验攻击');
    expect(text).toContain('出牌 1→敌0、2→敌1、3→敌0、4→敌1');
    expect(text).toContain('7 结束回合');
  });
  it('reports only changed sections in receipts but refreshes all decision facts on screen and session changes', () => {
    const before = combat(), after = structuredClone(before);
    after.revision++;
    const state = after.game!.combat_state as Record<string, unknown>;
    (state.player as Record<string, unknown>).energy = 2;
    state.hand = []; state.discard_pile = [(before.game!.combat_state as { hand: unknown[] }).hand[0]];
    after.actions = after.actions.slice(2);
    const text = renderReceipt({ outcome: 'executed', snapshot: after }, before, before.actions[0]);
    expect(text).toContain('已执行：试验攻击');
    expect(text).toContain('能量 2'); expect(text).toContain('手牌：\n无');
    expect(text).not.toContain('生命 60/80'); expect(text).not.toContain('试验遗物');
    expect(text).not.toContain('攻击 4×2');
    expect(text).toContain('1 丢弃、2 使用→敌1');
    after.screen = 'MAP'; expect(renderSnapshot(after, false, before)).toContain('生命 60/80');
    after.screen = before.screen; after.sessionId = 'new-session';
    expect(renderSnapshot(after, false, before)).toContain('生命 60/80');
  });
  it('preserves unknown intents and explicitly clears effects when they disappear', () => {
    const before = combat(), state = before.game!.combat_state as { player: Record<string, unknown>; monsters: Record<string, unknown>[] };
    state.monsters[0].intent = 'UNKNOWN'; state.monsters[0].move_adjusted_damage = 999;
    state.player.powers = [{ name: '虚弱', amount: 1, description: '攻击伤害降低。' }];
    state.player.orbs = [{ name: '闪电', passive_amount: 3, evoke_amount: 8 }];
    const after = structuredClone(before), player = (after.game!.combat_state as typeof state).player;
    after.revision++; player.powers = []; player.orbs = [];
    expect(renderSnapshot(before)).not.toContain('999');
    const delta = renderSnapshot(after, false, before);
    expect(delta).toContain('自身状态：无'); expect(delta).toContain('充能球：无');
  });
  it('repeats current intents across turns and identifies newly entered cards without exposing UUIDs', () => {
    const before = combat(), after = structuredClone(before);
    const state = after.game!.combat_state as { turn: number; hand: Record<string, unknown>[]; monsters: Record<string, unknown>[] };
    state.turn++; after.revision++;
    state.hand = [{ uuid: 'fresh-card', name: '新抽入的牌', cost: 0, description: '试验效果。' }];
    state.monsters[0].id = 'SlaverBlue';
    const sameTurn = structuredClone(after); (sameTurn.game!.combat_state as typeof state).turn--;
    const text = renderReceipt({ outcome: 'executed', snapshot: after }, sameTurn, before.actions.at(-1));
    expect(text).toContain('攻击 4×2'); expect(text).toContain('试验敌人（蓝衣）');
    const draw = renderReceipt({ outcome: 'executed', snapshot: after }, before, before.actions[0]);
    expect(draw).toContain('新入手：新抽入的牌'); expect(draw).not.toContain('fresh-card');
  });
  it('marks the current map node and preserves both selectable and confirmed upgrade previews', () => {
    const s = combat(); delete s.game!.combat_state; s.screen = 'MAP';
    s.game!.screen_state = { current_node: { x: 2, y: 6, symbol: 'M' } };
    expect(renderSnapshot(s)).toContain('当前位置：2,6 战斗');
    const original = { uuid: 'upgrade-card', name: '试验牌', cost: 2, type: 'SKILL', description: '原效果。' };
    const upgrade = { name: '试验牌+', cost: 1, type: 'SKILL', description: '升级效果。' };
    s.screen = 'GRID'; s.game!.screen_state = { cards: [{ ...original, upgrade }], for_upgrade: true, num_cards: 1 };
    s.actions = [{ id: 'choose:GRID:0', kind: 'select', label: '试验牌', details: original }];
    expect(renderSnapshot(s)).toContain('试验牌（技能，2费）：原效果。 → 试验牌+（技能，1费）：升级效果。');
    s.game!.screen_state = { confirm_up: true, for_upgrade: true, upgrade_preview: upgrade }; s.actions = [];
    expect(renderSnapshot(s)).toContain('确认升级为 试验牌+（技能，1费）：升级效果。');
  });
  it('explains a skipped card reward that the game still allows reopening', () => {
    const before = combat(); before.screen = 'CARD_REWARD'; delete before.game!.combat_state;
    const after = structuredClone(before); after.screen = 'COMBAT_REWARD'; after.revision++;
    after.game!.screen_state = { rewards: [{ reward_type: 'CARD' }] };
    after.actions = [{ id: 'choose:COMBAT_REWARD:0', kind: 'reward', label: 'cards' }];
    const action = { id: 'cancel', kind: 'cancel', label: 'skip' };
    expect(renderReceipt({ outcome: 'executed', snapshot: after }, before, action)).toContain('仍可重新打开选牌');
    after.game!.screen_state = { rewards: [{ reward_type: 'GOLD', gold: 10 }] };
    expect(renderReceipt({ outcome: 'executed', snapshot: after }, before, action)).not.toContain('仍可重新打开选牌');
  });
  it('states a collected item effect once in its new inventory location', () => {
    const before = combat(); before.screen = 'COMBAT_REWARD'; delete before.game!.combat_state;
    const potion = { id: 'reward-potion', name: '奖励药水', description: '试验药水效果。' };
    before.game!.screen_state = { rewards: [{ reward_type: 'POTION', potion }] };
    const after = structuredClone(before); after.revision++;
    after.game!.potions = [potion]; after.game!.screen_state = { rewards: [] }; after.actions = [];
    const action = { id: 'choose:COMBAT_REWARD:0', kind: 'reward', label: 'potion' };
    const text = renderReceipt({ outcome: 'executed', snapshot: after }, before, action);
    expect(text.split('\n')[0]).toBe('已执行：领取药水「奖励药水」。');
    expect(text.match(/试验药水效果/g)).toHaveLength(1);
  });
  it('renders event text, disabled choices and card-selection progress without duplicate option lists', () => {
    const s = combat(); s.screen = 'EVENT'; delete s.game!.combat_state;
    s.game!.screen_state = { event_name: '试验事件', body_text: '旅人提出交易。', options: [
      { choice_index: 0, text: '支付 10 金币，回复 8 生命。' }, { disabled: true, text: '需要另一件遗物。' },
    ] };
    s.actions = [{ id: 'choose:EVENT:0', kind: 'event', label: '交易', details: { text: '支付 10 金币，回复 8 生命。' } }];
    const text = renderSnapshot(s);
    expect(text.match(/支付 10 金币/g)).toHaveLength(1); expect(text).toContain('不可选：需要另一件遗物');
    s.screen = 'HAND_SELECT'; s.game!.screen_state = { max_cards: 2, selected: [{ name: '试验攻击' }], can_pick_zero: false };
    s.actions = [{ id: 'choose:HAND_SELECT:0', kind: 'select', label: '试验防御', details: { name: '试验防御', cost: 1, description: '获得 5 格挡。' } }];
    expect(renderSnapshot(s)).toContain('已选 1／2'); expect(renderSnapshot(s)).toContain('1 试验防御');
  });
  it('keeps shop prices and reward/key tradeoffs meaningful', () => {
    const s = combat(); s.screen = 'SHOP_SCREEN'; delete s.game!.combat_state;
    s.game!.screen_state = { purge_available: true, purge_cost: 20, cards: [],
      relics: [{ name: '廉价遗物', price: 10, description: '效果说明。' }, { name: '昂贵遗物', price: 100 }], potions: [] };
    s.actions = [{ id: 'choose:SHOP_SCREEN:0', kind: 'purge', label: 'purge', details: { price: 20 } },
      { id: 'choose:SHOP_SCREEN:1', kind: 'buy', label: 'internal-name', details: { price: 10 } }];
    expect(renderSnapshot(s)).toContain('廉价遗物：效果说明。 · 10金币');
    expect(renderSnapshot(s)).toContain('金币不足：昂贵遗物 100金币');
    s.screen = 'COMBAT_REWARD'; s.game!.screen_state = { rewards: [{ reward_type: 'GOLD', gold: 25 }, { reward_type: 'SAPPHIRE_KEY', link: { name: '竞争遗物' } }] };
    s.actions = [0, 1].map(i => ({ id: `choose:COMBAT_REWARD:${i}`, kind: 'reward', label: 'reward' }));
    expect(renderSnapshot(s)).toContain('1 领取 25 金币'); expect(renderSnapshot(s)).toContain('竞争遗物 二选一');
  });
  it('preserves card types from choice screens, explains energy symbols, and separates selection from confirmation', () => {
    const s = combat(); s.screen = 'CARD_REWARD'; delete s.game!.combat_state;
    const details = { uuid: 'reward-card', name: '试验能力', cost: 1, description: '获得 1 [R]。' };
    s.game!.screen_state = { cards: [{ ...details, type: 'POWER' }] };
    s.actions = [{ id: 'choose:CARD_REWARD:0', kind: 'card_reward', label: '试验能力', details }];
    expect(renderSnapshot(s)).toContain('试验能力（能力，1费）：获得 1 能量。');
    const text = renderReceipt({ outcome: 'executed', snapshot: s }, s, s.actions[0]);
    expect(text.split('\n')[0]).toBe('已执行：选择「试验能力」。');
    s.screen = 'GRID'; s.game!.screen_state = { confirm_up: true, for_upgrade: true, selected_cards: [], num_cards: 1 };
    expect(renderSnapshot(s)).toContain('升级：等待确认。');
    expect(renderSnapshot(s)).not.toContain('已选 0');
  });
  it('does not claim an uncertain action succeeded and gives a self-contained recovery snapshot', () => {
    const s = combat();
    const text = renderReceipt({ outcome: 'unknown', reason: 'Action deadline reached; observe before another action', snapshot: s }, s, s.actions[0]);
    expect(text).toContain('结果未确认'); expect(text).toContain('生命 60/80'); expect(text).not.toContain(' · 变化');
    const changed = structuredClone(s); changed.revision++;
    expect(stateRef(changed)).not.toBe(stateRef(s)); changed.revision--; changed.sessionId = 'another-game';
    expect(stateRef(changed)).not.toBe(stateRef(s));
  });
});
