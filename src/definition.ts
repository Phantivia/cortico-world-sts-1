import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { STS_DEFAULTS, type StsConfigSection } from './config.ts';
import { STS_TOOL_DECLS } from './tools.ts';
import { StsWorld } from './world.ts';

export const STS: WorldDefinition<StsConfigSection> = {
  id: 'sts-1', label: '杀戮尖塔', defaults: () => structuredClone(STS_DEFAULTS),
  create: ctx => new StsWorld({ cfg: ctx.cfg, timezone: ctx.timezone, dataDir: ctx.dataDir,
    token: () => ctx.secret('CORTICO_STS_1_TOKEN'), storeToken: value => ctx.storeSecret('CORTICO_STS_1_TOKEN', value) }),
  describe: {
    tools: describeTools(STS_TOOL_DECLS, {
      sts_observe: {
        zh: '读取当前局面和可选操作的编号,可另含牌组、各牌堆与全图。',
        en: 'Reads the current situation and the numbered actions, optionally with the deck, card piles and the full map.',
      },
      sts_do: {
        zh: '按编号执行一个操作(出牌、用药水、选路线等),等结算后回执结果和变化。',
        en: 'Performs one numbered action such as playing a card, using a potion or choosing a path, and reports the result once it resolves.',
      },
      sts_capture: {
        zh: '截取游戏画面,带游戏内光标。',
        en: 'Takes a screenshot of the game, including the in-game cursor.',
      },
      sts_input: {
        zh: '编号操作覆盖不到的界面上,直接点击坐标或按游戏按键。',
        en: 'Clicks a screen position or presses a game key on screens the numbered actions do not cover.',
      },
    }),
    events: [
      {
        type: 'sts-1.state',
        description: { zh: '游戏局面变了,附新的局面和操作编号。', en: 'The game state changed, with the new situation and numbered actions.' },
        trigger: 'flush',
        tags: ['snapshot'],
      },
      {
        type: 'sts-1.decision',
        description: {
          zh: '一轮动作结束后游戏仍在等待输入的提醒。',
          en: 'A reminder, after a turn that acted, that the game is still waiting for input.',
        },
        trigger: 'flush',
      },
      {
        type: 'sts-1.connection',
        description: {
          zh: '与游戏里的 Mod 的连接断开;已提交动作的结果可能没确认。',
          en: 'The connection to the in-game mod dropped; results of submitted actions may be unconfirmed.',
        },
        trigger: 'flush',
      },
    ],
  },
};
