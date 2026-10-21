export interface ReinaFailure { code: string; message: string; retryable: boolean }

const known: Record<string, [string, boolean]> = {
  NOT_CONNECTED: ['数据连接不存在，请在设置中选择 ReinaManager 数据库。', false],
  SOURCE_NOT_FOUND: ['无法读取数据库：来源文件不存在或不能打开，请重新选择。', false],
  SOURCE_BUSY: ['无法读取数据库：ReinaManager 正在保存，请稍后重试；持续占用时关闭 ReinaManager 后重试。', true],
  SCHEMA_UNSUPPORTED: ['无法读取数据库：来源结构不兼容或存在无效会话，请核对 ReinaManager 版本与记录。', false],
  PERMISSION_DENIED: ['无法读取数据库：没有读取来源文件的权限，请选择可读取的数据库。', false],
  INVALID_INPUT: ['游玩记录查询参数无效，作品不存在或范围超出当前快照，请重新选择。', false],
  DATA_LIMIT_EXCEEDED: ['记录超过桥接上限，请缩小查询范围或减少来源目录规模。', false],
  QUERY_TIMEOUT: ['读取游玩记录超时，请稍后刷新。', true],
  SNAPSHOT_EXPIRED: ['快照已失效，请刷新游玩记录。', true],
  SOURCE_CHANGED: ['授权数据库已移动、被替换或不可读取，请重新选择数据库并确认关联。', false],
  LINK_CHANGED: ['作品资料编号已改变，请解绑并重新确认关联。', false],
};

/** Only fixed messages cross the process/MCP boundary; raw SQLite diagnostics stay private. */
export function reinaFailure(error: unknown): ReinaFailure {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (Object.hasOwn(known, code)) return { code, message: known[code][0], retryable: known[code][1] };
  const message = error instanceof Error ? error.message : '';
  const cases: [RegExp, string][] = [
    [/^(分页已失效|快照已失效)/, 'SNAPSHOT_EXPIRED'],
    [/^授权数据库/, 'SOURCE_CHANGED'], [/^作品资料编号已改变/, 'LINK_CHANGED'],
    [/^记录超过/, 'DATA_LIMIT_EXCEEDED'], [/^(读取游玩记录超时|游玩记录查询超时|游玩记录读取超时)/, 'QUERY_TIMEOUT'],
    [/^数据连接不存在/, 'NOT_CONNECTED'],
    [/^(游玩记录查询参数|请选择完整|资料来源和编号|来源作品(?:已)?不存在)/, 'INVALID_INPUT'],
  ];
  for (const [pattern, key] of cases) if (pattern.test(message)) return { code: key, message: known[key][0], retryable: known[key][1] };
  return { code: 'SOURCE_UNAVAILABLE', message: '无法读取数据库，请选择兼容的 ReinaManager 数据库；若来源正在保存，请稍后重试。', retryable: true };
}

export function reinaError(code: keyof typeof known): Error {
  return Object.assign(new Error(known[code][0]), { code, retryable: known[code][1] });
}
