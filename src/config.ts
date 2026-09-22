import type { ConfigGroup } from 'cortico/core/types.ts';

export interface StsConfigSection {
  enabled: boolean;
  gameDir: string;
  javaFile: string;
  modTheSpireFile: string;
  launch: boolean;
  port: number;
  connectTimeoutMs: number;
  actionTimeoutMs: number;
  cursorDurationMs: number;
}

export const STS_DEFAULTS: StsConfigSection = {
  enabled: false, gameDir: '', javaFile: '', modTheSpireFile: '', launch: false,
  port: 27831, connectTimeoutMs: 120000, actionTimeoutMs: 30000, cursorDurationMs: 240,
};

export const STS_CONFIG_GROUP: ConfigGroup = {
  id: 'world:sts-1', owner: 'world:sts-1', schema: {
    type: 'object', title: '杀戮尖塔', properties: {
      'worlds.sts-1.gameDir': { type: 'string', title: '游戏目录', 'x-path': { kind: 'directory' }, 'x-hot': false },
      'worlds.sts-1.javaFile': { type: 'string', title: 'Java 程序', description: '留空使用游戏 jre/bin/java.exe。', 'x-path': { kind: 'file' }, 'x-hot': false },
      'worlds.sts-1.modTheSpireFile': { type: 'string', title: 'ModTheSpire.jar', description: '留空查找游戏目录和 Steam Workshop。', 'x-path': { kind: 'file', extensions: ['.jar'] }, 'x-hot': false },
      'worlds.sts-1.launch': { type: 'boolean', title: '挂载时启动游戏', description: '停用 World 时保留游戏。', 'x-hot': false },
      'worlds.sts-1.port': { type: 'integer', minimum: 1024, maximum: 65535, title: 'Sidecar 端口', 'x-hot': false },
      'worlds.sts-1.connectTimeoutMs': { type: 'integer', minimum: 1000, maximum: 300000, title: '启动连接期限', 'x-suffix': 'ms', 'x-hot': false },
      'worlds.sts-1.actionTimeoutMs': { type: 'integer', minimum: 1000, maximum: 120000, title: '动作结算期限', 'x-suffix': 'ms', 'x-hot': true },
      'worlds.sts-1.cursorDurationMs': { type: 'integer', minimum: 0, maximum: 2000, title: '光标每段移动时长', 'x-suffix': 'ms', 'x-hot': true },
    },
  },
};
