import { createHash } from 'node:crypto';
import type { StsAction, StsReceipt, StsSnapshot } from './protocol.ts';

type Fields = Record<string, unknown>;
const object = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const list = (value: unknown): Fields[] => Array.isArray(value) ? value.map(object) : [];
const words = (value: unknown): string => typeof value === 'string' ? value.replace(/\s*NL\s*|\s*\n\s*/g, '；')
  .replace(/#[rgbypw]|[~@]/g, '').replace(/\s+([，。；！？])/g, '$1').replace(/([。！？；])；/g, '$1').trim() : '';
const name = (value: Fields): string => words(value.name) || words(value.id) || '未知';
const number = (value: unknown, fallback = 0): number => typeof value === 'number' ? value : fallback;
const screens: Record<string, string> = {
  MAIN_MENU: '主菜单', COMBAT: '战斗', MAP: '地图', EVENT: '事件', REST: '休息点', CHEST: '宝箱',
  SHOP_ROOM: '商人', SHOP_SCREEN: '商店', COMBAT_REWARD: '战利品', CARD_REWARD: '选奖励牌',
  BOSS_REWARD: '选首领遗物', GRID: '选牌', HAND_SELECT: '选手牌', DEATH: '游戏结束', VICTORY: '胜利',
  MASTER_DECK_VIEW: '查看牌组', DRAW_PILE_VIEW: '查看抽牌堆', DISCARD_VIEW: '查看弃牌堆', EXHAUST_VIEW: '查看消耗堆',
  NONE: '房间', LOADING: '载入中', GAME_OVER: '结算',
};
const symbols: Record<string, string> = { M: '战斗', E: '精英', R: '休息', '$': '商店', T: '宝箱', '?': '未知', B: '首领' };
const intents: Record<string, string> = {
  ATTACK: '攻击', ATTACK_BUFF: '攻击并强化', ATTACK_DEBUFF: '攻击并施加负面效果', ATTACK_DEFEND: '攻击并防御',
  BUFF: '强化', DEBUFF: '施加负面效果', STRONG_DEBUFF: '施加强力负面效果', DEFEND: '防御',
  DEFEND_BUFF: '防御并强化', DEFEND_DEBUFF: '防御并施加负面效果', ESCAPE: '逃跑', MAGIC: '特殊行动',
  SLEEP: '睡眠', STUN: '眩晕', UNKNOWN: '未知', NONE: '未显示', DEBUG: '尚未显示',
};

/** Public references bind short action numbers to an exact native session and revision. */
export function stateRef(snapshot: StsSnapshot): string {
  return createHash('sha256').update(`${snapshot.sessionId}:${snapshot.revision}`).digest('hex').slice(0, 12);
}
export function screenName(snapshot: StsSnapshot): string { return screens[snapshot.screen] ?? snapshot.screen; }

function card(card: Fields): string {
  const cost = number(card.cost, -2);
  const fee = cost === -1 ? 'X费' : cost < 0 ? '不可打出' : `${cost}费`;
  const kind = ({ ATTACK: '攻击', SKILL: '技能', POWER: '能力', STATUS: '状态', CURSE: '诅咒' } as Record<string, string>)[words(card.type)];
  const description = words(card.description);
  const flags = [card.exhausts && !description.includes('消耗') ? '消耗' : '',
    card.ethereal && !description.includes('虚无') ? '虚无' : '', card.retains && !description.includes('保留') ? '保留' : ''].filter(Boolean);
  return `${name(card)}（${kind ? kind + '，' : ''}${fee}${flags.length ? '，' + flags.join('、') : ''}）${description ? '：' + description : ''}`;
}
function item(item: Fields): string {
  return name(item) + (number(item.counter, -1) >= 0 ? `(${item.counter})` : '')
    + (words(item.description) ? '：' + words(item.description) : '');
}
function groupedCards(cards: Fields[], descriptions = false): string {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const text = descriptions ? card(c) : name(c);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, count]) => `${count > 1 ? count + '×' : ''}${text}`).join('；') || '无';
}
function powers(value: unknown): string {
  return list(value).map(p => `${name(p)} ${p.amount ?? '?'}${words(p.description) ? '（' + words(p.description) + '）' : ''}`).join('；');
}
function node(value: Fields): string { return `${value.x},${value.y} ${symbols[words(value.symbol)] ?? words(value.symbol)}`.trim(); }
function choiceIndex(action: StsAction): number { return Number(action.id.split(':').at(-1)); }

function actionText(action: StsAction, snapshot: StsSnapshot): string {
  const g = object(snapshot.game), s = object(g.screen_state), d = action.details ?? {};
  const i = choiceIndex(action);
  if (action.kind === 'map') return d.x !== undefined ? node(d) : '前往首领';
  if (action.kind === 'event') return words(d.text) || words(list(s.options).find(o => o.choice_index === i)?.text) || action.label;
  if (action.kind === 'card_reward' || action.kind === 'select') return d.name ? card(d) : action.label === 'bowl' ? '歌唱碗：增加最大生命' : action.label;
  if (action.kind === 'boss_relic') return item(list(s.relics)[i] ?? d);
  if (action.kind === 'reward') {
    const reward = list(s.rewards)[i] ?? {};
    switch (reward.reward_type) {
      case 'GOLD': case 'STOLEN_GOLD': return `领取 ${reward.gold} 金币`;
      case 'CARD': return '选择奖励牌';
      case 'RELIC': return `领取遗物 ${item(object(reward.relic))}`;
      case 'POTION': return `领取药水 ${item(object(reward.potion))}`;
      case 'SAPPHIRE_KEY': return `蓝宝石钥匙（与 ${name(object(reward.link))} 二选一）`;
      case 'EMERALD_KEY': return '绿宝石钥匙';
    }
  }
  if (action.kind === 'buy') {
    const offers = [...list(s.cards), ...list(s.relics), ...list(s.potions)].filter(item => number(item.price) <= number(g.gold));
    const offset = s.purge_available && number(s.purge_cost) <= number(g.gold) ? 1 : 0;
    const offer = offers[i - offset] ?? d;
    return `${offer.uuid ? card(offer) : item(offer)} · ${offer.price ?? d.price ?? '?'}金币`;
  }
  if (action.kind === 'purge') return `移除一张牌 · ${d.price ?? s.purge_cost ?? '?'}金币`;
  if (action.kind === 'rest') return ({ rest: '休息：回复生命', smith: '锻造：升级牌', dig: '挖掘遗物', lift: '举重', toke: '移除牌', recall: '回忆：红宝石钥匙' })[action.label as 'rest'] ?? action.label;
  if (action.kind === 'shop') return '进入商店';
  if (action.kind === 'chest') return '打开宝箱';
  if (action.kind === 'confirm') return ({ proceed: '继续', confirm: '确认', leave: '离开' })[action.label as 'confirm'] ?? action.label;
  if (action.kind === 'cancel') return ({ skip: '跳过', return: '返回', leave: '离开', cancel: '取消' })[action.label as 'skip'] ?? action.label;
  if (action.kind === 'view') return '查看' + (({ map: '地图', deck: '牌组', draw_pile: '抽牌堆', discard_pile: '弃牌堆', exhaust_pile: '消耗堆' })[action.id.slice(5) as 'map'] ?? action.label);
  return action.label;
}

/** Sections are compared as visible text; transient native fields never enter model context. */
function sections(snapshot: StsSnapshot, full: boolean): Map<string, string> {
  const result = new Map<string, string>();
  const put = (key: string, text: string) => result.set(key, text);
  const g = object(snapshot.game), s = object(g.screen_state), combat = object(g.combat_state), player = object(combat.player);
  if (snapshot.game) {
    put('run', `第${g.act ?? '?'}幕 · 第${g.floor ?? '?'}层 · 生命 ${g.current_hp ?? '?'}/${g.max_hp ?? '?'} · 金币 ${g.gold ?? '?'}`);
    put('relics', `遗物：${list(g.relics).map(item).join('；') || '无'}`);
    const keys = Object.entries(object(g.keys)).filter(([, owned]) => owned).map(([key]) => ({ ruby: '红宝石', emerald: '绿宝石', sapphire: '蓝宝石' })[key as 'ruby'] ?? key);
    if (keys.length) put('keys', `钥匙：${keys.join('、')}`);
  }
  const used = new Set<string>();
  const ref = (action: StsAction): string => { used.add(action.id); return String(snapshot.actions.indexOf(action) + 1); };
  if (g.combat_state) {
    const stance = ({ Neutral: '', Wrath: '愤怒', Calm: '平静', Divinity: '神格' })[words(player.stance) as 'Neutral'] ?? words(player.stance);
    put('combat', `回合 ${combat.turn ?? '?'} · 能量 ${player.energy ?? '?'} · 格挡 ${player.block ?? 0}${stance ? ' · 姿态 ' + stance : ''}`);
    put('powers', `自身状态：${powers(player.powers) || '无'}`);
    if (list(player.orbs).length) put('orbs', `充能球：${list(player.orbs).map(o => `${name(o)}（被动 ${o.passive_amount}／激发 ${o.evoke_amount}）`).join('；')}`);
    put('monsters', '敌人：\n' + list(combat.monsters).map((m, i) => {
      const intent = intents[words(m.intent)] ?? words(m.intent);
      const damage = words(m.intent).startsWith('ATTACK') && number(m.move_adjusted_damage, -1) >= 0 ? ` ${m.move_adjusted_damage}×${m.move_hits ?? 1}` : '';
      return `敌${m.index ?? i} ${name(m)} · ${m.current_hp}/${m.max_hp}生命 · ${m.block ?? 0}格挡 · ${m.is_gone ? '已离场' : m.half_dead ? '暂时倒下' : intent + damage}${powers(m.powers) ? '；' + powers(m.powers) : ''}`;
    }).join('\n'));
    if (snapshot.screen !== 'HAND_SELECT') {
      const hand = new Map<string, { count: number; choices: string[] }>();
      for (const c of list(combat.hand)) {
        const actions = snapshot.actions.filter(a => a.kind === 'play' && (a.details?.uuid === c.uuid || a.id === `play:${c.uuid}` || a.id.startsWith(`play:${c.uuid}:`)));
        const text = card(c) + (actions.length ? '' : '（当前不可打出）');
        const group = hand.get(text) ?? { count: 0, choices: [] };
        group.count++;
        group.choices.push(...actions.map(a => `${ref(a)}${a.id.startsWith(`play:${c.uuid}:`) ? '→敌' + a.id.split(':').at(-1) : ''}`));
        hand.set(text, group);
      }
      put('hand', '手牌：\n' + ([...hand].map(([text, group]) => `${group.count > 1 ? group.count + '×' : ''}${text}${group.choices.length ? '　出牌 ' + group.choices.join('、') : ''}`).join('\n') || '无'));
    }
    put('piles', `牌堆：抽 ${list(combat.draw_pile).length}／弃 ${list(combat.discard_pile).length}／消耗 ${list(combat.exhaust_pile).length}`);
    for (const [key, label, screen] of [['draw_pile', '抽牌堆（无序）', 'DRAW_PILE_VIEW'], ['discard_pile', '弃牌堆', 'DISCARD_VIEW'], ['exhaust_pile', '消耗堆', 'EXHAUST_VIEW']]) {
      if (full || snapshot.screen === screen) put(key, `${label}：${groupedCards(list(combat[key]), true)}`);
    }
  }
  if (snapshot.game) {
    const potions = list(g.potions);
    put('potions', '药水：' + (potions.map((p, slot) => {
      if (p.id === 'Potion Slot') return '';
      const actions = snapshot.actions.filter(a => a.id === `discard_potion:${slot}` || a.id === `use_potion:${slot}` || a.id.startsWith(`use_potion:${slot}:`));
      return item(p) + (actions.length ? '　' + actions.map(a => `${ref(a)} ${a.kind === 'discard_potion' ? '丢弃' : '使用'}${a.id.split(':').length === 3 ? '→敌' + a.id.split(':').at(-1) : ''}`).join('、') : '（当前不可用）');
    }).filter(Boolean).join('；') || '无') + (potions.length ? ` · ${potions.filter(p => p.id === 'Potion Slot').length}空槽` : ''));
  }
  if (snapshot.screen === 'EVENT') put('event', `${words(s.event_name)}\n${words(s.body_text)}`.trim());
  if (snapshot.screen === 'HAND_SELECT' || snapshot.screen === 'GRID') {
    const selected = list(s.selected ?? s.selected_cards);
    const purpose = s.for_upgrade ? '升级' : s.for_transform ? '变形' : s.for_purge ? '移除' : '选择';
    put('selection', `${purpose}：已选 ${selected.length}／${s.max_cards ?? s.num_cards ?? '?'}${s.can_pick_zero || s.any_number ? '，允许少选' : ''}；${groupedCards(selected)}`);
  }
  if (['GAME_OVER', 'VICTORY', 'DEATH'].includes(snapshot.screen)) put('result', `${s.victory ? '胜利' : '游戏结束'} · 得分 ${s.score ?? '?'}`);
  const actions = snapshot.actions.filter(a => !used.has(a.id));
  if (actions.length) put('actions', '操作：\n' + actions.map(a => `${ref(a)} ${actionText(a, snapshot)}`).join('\n'));
  else put('actions', '暂无其他操作。');
  const disabled = list(s.options).filter(o => o.disabled);
  if (disabled.length) put('disabled', '不可选：' + disabled.map(o => words(o.text)).join('；'));
  if (snapshot.screen === 'SHOP_SCREEN') {
    const unavailable = [...list(s.cards), ...list(s.relics), ...list(s.potions)].filter(i => number(i.price) > number(g.gold));
    if (unavailable.length) put('unaffordable', '金币不足：' + unavailable.map(i => `${name(i)} ${i.price}金币${full && i.description ? '（' + words(i.description) + '）' : ''}`).join('；'));
  }
  if (snapshot.screen === 'MAP' || full) {
    const rows = new Map<number, string[]>();
    for (const n of list(g.map)) {
      const y = number(n.y), row = rows.get(y) ?? [];
      row.push(`${n.x}${symbols[words(n.symbol)] ?? words(n.symbol)}→${list(n.children).map(c => c.x).join(',') || '终点'}`);
      rows.set(y, row);
    }
    if (rows.size) put('map', `路线（y行：x类型→下一行x）：${[...rows].sort(([a], [b]) => a - b).map(([y, nodes]) => `${y}: ${nodes.join('；')}`).join('\n')}\n首领：${g.act_boss ?? '?'}`);
  }
  if (snapshot.game && (full || snapshot.screen === 'MASTER_DECK_VIEW')) {
    put('deck', `牌组 ${list(g.deck).length}张：${groupedCards(list(g.deck), true)}`);
    if (snapshot.game) put('character', `角色 ${g.class ?? '?'} · 进阶 ${g.ascension_level ?? 0}`);
  }
  return result;
}

export function renderSnapshot(snapshot: StsSnapshot, full = false, previous?: StsSnapshot): string {
  const delta = !full && previous?.sessionId === snapshot.sessionId && previous.screen === snapshot.screen
    && previous.game?.floor === snapshot.game?.floor;
  const current = sections(snapshot, full), before = delta ? sections(previous!, false) : new Map<string, string>();
  const lines = [...current].filter(([key, text]) => !delta || before.get(key) !== text).map(([, text]) => text);
  if (delta) for (const [key] of before) if (!current.has(key)) lines.push(({ orbs: '充能球：无', keys: '钥匙：无', disabled: '不可选项已清空。', unaffordable: '金币不足项已清空。' })[key as 'orbs'] ?? '界面内容已更新。');
  return `[StS ${stateRef(snapshot)} · ${screenName(snapshot)} · ${snapshot.ready ? '可操作' : '结算中'}${delta ? ' · 变化' : ''}]\n${lines.join('\n') || '状态无变化，操作编号沿用上一份。'}`;
}

export function renderReceipt(receipt: StsReceipt, before: StsSnapshot, action?: StsAction): string {
  const label = action ? actionText(action, before) : '游戏内输入';
  const reasons: Record<string, string> = {
    'Stale snapshot or game not ready': '状态已变化或尚在结算，未提交输入', 'Stale snapshot': '状态已变化，未提交输入',
    'Snapshot changed before input': '光标移动期间状态发生变化，未提交输入',
    'Action is not available in this snapshot': '当前状态没有此操作', 'Another action is in flight': '上一个动作尚未结束',
    'Cancelled before input': '输入前已取消', 'Action deadline reached; observe before another action': '等待结算超时，请先观察再决定是否重试',
  };
  const result = receipt.outcome === 'executed' ? `已执行：${label}。`
    : `${receipt.outcome === 'rejected' ? '未执行' : '结果未确认'}：${receipt.reason ? reasons[receipt.reason] ?? receipt.reason : label}。`;
  return `${result}\n${renderSnapshot(receipt.snapshot, false, receipt.outcome === 'executed' ? before : undefined)}`;
}
