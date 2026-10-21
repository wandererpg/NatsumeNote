/**
 * ReinaManager 只读 SQLite 适配器。
 *
 * 核对依据（源码事实，见 docs/reina-mcp-source-evidence.md）：
 * - `entity/game_sessions.rs:9-16`：会话五列全部非空，时间戳为 Unix 秒 i32，`duration` 为分钟 i32。
 * - `game/monitor/session.rs:23-25`：分钟是四舍五入结果，因此 `duration * 60` 只能是“分钟粒度”的
 *   规范化值，不能当作秒级精确有效时长；本适配器同时保留 `recordedMinutes`。
 * - `session.rs:48-53`：`duration` 由计时模式决定（前台累计或自然经过），历史行不保存模式，
 *   所以 `trackingMode` / `recordKind` 恒为 `'unknown'`，不用 `end_time - start_time` 替代。
 * - `repository/game_stats_repository.rs:443`：`date` 是写入当刻本地时区的结束日期，属于来源原值。
 * - `repository/game_stats_repository.rs:504-506`：来源自带分页只按 `start_time DESC`，本适配器
 *   追加 `session_id DESC` 次级键以获得稳定顺序。
 * - `repository/game_stats_repository.rs:303-319`：`last_played` 取已有值与 `end_time` 的较大者，
 *   单位同秒；仍可能陈旧，故与派生值分开返回。
 * - `entity/game_statistics.rs:11-15`：`total_time` / `session_count` / `last_played` 可空，
 *   缺失必须是 `null` 而不是 0。
 * - `entity/games.rs:19-45`：`games` 没有 name/tags 列；名称来自 `custom_data`(Text/JSON) 与
 *   `game_sources.data`(JSON) 的 `name` / `name_cn`，标签来自 `custom_data.tags` 与
 *   `game_sources.data.tags`。`displayMergeRules.ts:14-31` 显示来源别名 `bgm` 即 Bangumi。
 *
 * 明确不做：`migrate`、写 `journal_mode`、`checkpoint`、`immutable`、建库、写回、复制 db。
 * 只以 `readonly + fileMustExist` 打开，并设置连接级 `query_only`；SQL 全部为固定语句，
 * 只用命名参数绑定，不拼接任何客户端输入。
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';

import type {
  ReinaConnection,
  ReinaGame,
  ReinaProvider,
  ReinaSession,
  ReinaStats,
  ReinaTag,
} from '../../shared/reina';

/** 已核对布局的 profile 标识；括号内是实际读到的列数与迁移标记，用于诊断漂移。 */
export const REINA_SCHEMA_PROFILE_ID = 'reinamanager.v1';
/** 单次快照/查询允许的会话行上限。超出即失败，绝不静默截断。 */
export const MAX_SESSION_ROWS = 50_000;
/** 单次快照允许的规范化数据字节上限。 */
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
/** 首版目录查询上限；超出显式报错，等待分页支持再放开。 */
export const MAX_GAMES = 5_000;
/** 单个作品参与桥接的标签上限。 */
export const MAX_TAGS_PER_GAME = 300;
/** 单条标签最大长度（UTF-16 码元）；超长标签视为异常数据丢弃。 */
export const MAX_TAG_LENGTH = 200;
/** 来源 `date` 文本长度上限；超长视为异常行。 */
export const MAX_SOURCE_DATE_LENGTH = 512;
/** 只读连接上的 busy 等待时间。 */
export const BUSY_TIMEOUT_MS = 500;
/**
 * 已核对的迁移历史，顺序即 `src-tauri/migration/src/lib.rs` 里 Migrator 的应用顺序
 * （22 个迁移全部核对，截至 `m20261006_000022_nextmoe_oauth`）。
 *
 * 迁移表是“这不是相似列、而是同一来源结构”的证据，`verifySchema` 因此要求：
 * - 存在 `seaql_migrations` 且带 `version` 列；
 * - 起手行就是 baseline `m20250927_000001_baseline_migration`（否则可能是别的应用的同名列）；
 * - 每一行都在本清单内。来源升级到清单外的迁移时拒绝，等桥接侧重新核对后再放开。
 *
 * 实际支持的源码结构范围（不是“列名看着像就兼容”）：
 * - `game_sources` 由迁移 000014 建立（source/data/PK(game_id,source)/FK CASCADE），
 *   更早版本的库没有这张表，会被 `verifySchema` 拒绝；
 * - `games.custom_data` 由 000004 加列，同属必需列；
 * - 000015/000019/000020/000021 只给 games/user 增加列，不动本文件读取的任何列；
 * - 000022 增加 user.nextmoe_auth 并清理/解绑旧 Kun 编号，不改会话/统计列或时长单位；
 *   增量核对提交 4d2c9440bdbd088a73e1c4abf95a7b9ae35dc31c，见 docs/reina-mcp-compatibility-22.md。
 * - 来源侧一旦删除或改名 `REQUIRED_SCHEMA` 里的列，`verifySchema` 拒绝而不是猜单位。
 */
const AUDITED_MIGRATIONS: readonly string[] = [
  'm20250927_000001_baseline_migration',
  'm20250928_000002_split_games_table',
  'm20250930_000003_add_collections',
  'm20251229_000004_hybrid_single_table',
  'm20260104_000005_add_le_magpie_fields',
  'm20260131_000006_migrate_clear_to_play_status',
  'm20260201_000007_clean_empty_strings',
  'm20260318_000008_add_vndb_token_and_collection_sync',
  'm20260331_000009_add_kungal_support',
  'm20260505_000010_remove_redundant_created_at',
  'm20260508_000011_bgm_oauth',
  'm20260525_000012_move_custom_date_to_games',
  'm20260706_000013_reconcile_indexes',
  'm20260706_000014_migrate_game_sources',
  'm20260712_000015_split_game_local_path',
  'm20260722_000016_backfill_game_defaults',
  'm20260801_000017_add_tasks',
  'm20260805_000018_hikarinagi_oauth',
  'm20260809_000019_add_steam_launch',
  'm20260922_000020_savedata_backup_root_semantics',
  'm20260923_000021_tool_integration_defaults',
  'm20261006_000022_nextmoe_oauth',
];
/** 清单成员集合：用于拒绝清单外的迁移（含来源升级后新增的迁移）。 */
const AUDITED_MIGRATION_SET: ReadonlySet<string> = new Set(AUDITED_MIGRATIONS);

const MAX_SOURCE_ROWS = MAX_GAMES * 8;
const MAX_EPOCH_SECONDS = 253_402_300_799; // 9999-12-31T23:59:59Z

export type ReinaErrorCode =
  | 'NOT_CONNECTED'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_BUSY'
  | 'SCHEMA_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'DATA_LIMIT_EXCEEDED'
  | 'QUERY_TIMEOUT';

/** 适配器错误；`retryable` 只表达“重试可能成功”，不表达权限已具备。 */
export class ReinaAdapterError extends Error {
  readonly code: ReinaErrorCode;
  readonly retryable: boolean;

  constructor(code: ReinaErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'ReinaAdapterError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** 快照结果：同一短只读事务里取到的会话与统计（遇到非法行会整次失败，不做部分返回）。 */
export interface ReinaSnapshot {
  readonly sessions: ReinaSession[];
  readonly stats: ReinaStats;
}

type TypeAffinity = 'INTEGER' | 'TEXT';

interface RequiredColumn {
  readonly name: string;
  readonly affinity: TypeAffinity;
}

interface RequiredTable {
  readonly table: string;
  /**
   * 固定字面量：表名不来自任何输入，禁止改成字符串插值。
   * 用 `table_xinfo` 而非 `table_info`：来源里 `games.user_rating`、
   * `game_sources.score/rank` 是 VIRTUAL 生成列，`table_info` 会漏掉它们，
   * 用 xinfo 才能让 profile 的列数与来源 DDL 一致（生成列一并计数）。
   */
  readonly infoSql: string;
  readonly columns: readonly RequiredColumn[];
  /** 主键列，按主键序号排列；用于确认行身份稳定。 */
  readonly primaryKey: readonly string[];
}

const REQUIRED_SCHEMA: readonly RequiredTable[] = [
  {
    table: 'games',
    infoSql: 'PRAGMA table_xinfo(games)',
    columns: [
      { name: 'id', affinity: 'INTEGER' },
      { name: 'custom_data', affinity: 'TEXT' },
    ],
    primaryKey: ['id'],
  },
  {
    table: 'game_sessions',
    infoSql: 'PRAGMA table_xinfo(game_sessions)',
    columns: [
      { name: 'session_id', affinity: 'INTEGER' },
      { name: 'game_id', affinity: 'INTEGER' },
      { name: 'start_time', affinity: 'INTEGER' },
      { name: 'end_time', affinity: 'INTEGER' },
      { name: 'duration', affinity: 'INTEGER' },
      { name: 'date', affinity: 'TEXT' },
    ],
    primaryKey: ['session_id'],
  },
  {
    table: 'game_statistics',
    infoSql: 'PRAGMA table_xinfo(game_statistics)',
    columns: [
      { name: 'game_id', affinity: 'INTEGER' },
      { name: 'total_time', affinity: 'INTEGER' },
      { name: 'session_count', affinity: 'INTEGER' },
      { name: 'last_played', affinity: 'INTEGER' },
    ],
    primaryKey: ['game_id'],
  },
  {
    table: 'game_sources',
    infoSql: 'PRAGMA table_xinfo(game_sources)',
    columns: [
      { name: 'game_id', affinity: 'INTEGER' },
      { name: 'source', affinity: 'TEXT' },
      { name: 'external_id', affinity: 'TEXT' },
      { name: 'data', affinity: 'TEXT' },
    ],
    primaryKey: ['game_id', 'source'],
  },
];

const SQL_SELECT_GAMES = 'SELECT id, custom_data FROM games ORDER BY id ASC LIMIT @limit';
const SQL_SELECT_SOURCES =
  'SELECT game_id, source, external_id, data FROM game_sources ORDER BY game_id ASC, source ASC LIMIT @limit';
const SQL_SELECT_SESSIONS = `
  SELECT session_id, game_id, start_time, end_time, duration, date
  FROM game_sessions
  WHERE game_id = @gameId
    AND (@fromSec IS NULL OR start_time >= @fromSec)
    AND (@toSec IS NULL OR start_time < @toSec)
  ORDER BY start_time DESC, session_id DESC
  LIMIT @limit
`;
const SQL_SELECT_STATS =
  'SELECT total_time, session_count, last_played FROM game_statistics WHERE game_id = @gameId';

interface TableInfoRow {
  name: string;
  type: string;
  pk: number;
}

interface GameRow {
  id: unknown;
  custom_data: unknown;
}

interface SourceRow {
  game_id: unknown;
  source: unknown;
  external_id: unknown;
  data: unknown;
}

interface SessionRow {
  session_id: unknown;
  game_id: unknown;
  start_time: unknown;
  end_time: unknown;
  duration: unknown;
  date: unknown;
}

interface StatsRow {
  total_time: unknown;
  session_count: unknown;
  last_played: unknown;
}

interface TimeRange {
  readonly fromSec: number | null;
  readonly toSec: number | null;
}

const NO_RANGE: TimeRange = { fromSec: null, toSec: null };

/** 带 Z 或显式偏移的完整 ISO 时间；不接受仅有日期或本地隐含时区的写法。 */
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function affinityMatches(declared: string, expected: TypeAffinity): boolean {
  const type = declared.trim().toUpperCase();
  if (expected === 'INTEGER') return type.includes('INT');
  // SeaORM `Text` 生成 text，`Json` 在 SQLite 生成 json；两者都按 TEXT 处理。
  return (
    type.includes('TEXT') || type.includes('CHAR') || type.includes('CLOB') || type.includes('JSON')
  );
}

function toAdapterError(error: unknown): ReinaAdapterError {
  if (error instanceof ReinaAdapterError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/file is not a database|no such table|malformed|not a database/i.test(message)) {
    return new ReinaAdapterError(
      'SCHEMA_UNSUPPORTED',
      '所选文件不是可识别的 ReinaManager 数据库（缺少游戏/会话表或文件已损坏）',
    );
  }
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return new ReinaAdapterError(
      'SOURCE_BUSY',
      '数据库正被其他进程占用，请稍后重试；持续失败时关闭 ReinaManager 后再试',
      true,
    );
  }
  if (/readonly|SQLITE_READONLY|permission|EACCES|EPERM/i.test(message)) {
    return new ReinaAdapterError('PERMISSION_DENIED', '没有读取该数据库文件的权限');
  }
  if (/unable to open database file|ENOENT|SQLITE_CANTOPEN/i.test(message)) {
    return new ReinaAdapterError('SOURCE_NOT_FOUND', '找不到该数据库文件，或路径不是普通文件');
  }
  return new ReinaAdapterError('SOURCE_NOT_FOUND', `无法读取该数据库：${message}`);
}

function verifySchema(db: Database.Database): string {
  const shapes: string[] = [];

  for (const spec of REQUIRED_SCHEMA) {
    const rows = db.prepare(spec.infoSql).all() as TableInfoRow[];
    if (rows.length === 0) {
      throw new ReinaAdapterError(
        'SCHEMA_UNSUPPORTED',
        `缺少 ${spec.table} 表：这不是已核对的 ReinaManager 数据库布局（${REINA_SCHEMA_PROFILE_ID}）`,
      );
    }

    const byName = new Map(rows.map((row) => [row.name, row]));
    for (const column of spec.columns) {
      const info = byName.get(column.name);
      if (!info) {
        throw new ReinaAdapterError(
          'SCHEMA_UNSUPPORTED',
          `${spec.table} 缺少 ${column.name} 列：无法确认时间戳或时长语义，拒绝按分钟解释`,
        );
      }
      if (!affinityMatches(info.type ?? '', column.affinity)) {
        throw new ReinaAdapterError(
          'SCHEMA_UNSUPPORTED',
          `${spec.table}.${column.name} 的声明类型为 “${info.type}”，与已核对布局不一致`,
        );
      }
    }

    const primaryKey = rows
      .filter((row) => row.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((row) => row.name);
    if (primaryKey.join(',') !== spec.primaryKey.join(',')) {
      throw new ReinaAdapterError(
        'SCHEMA_UNSUPPORTED',
        `${spec.table} 的主键为 (${primaryKey.join(', ')})，与已核对布局不一致`,
      );
    }

    // 列数用 xinfo 计数：包含来源的 VIRTUAL 生成列（games.user_rating、
    // game_sources.score/rank），所以与来源 DDL 的列数一致。
    shapes.push(`${spec.table}:${rows.length}`);
  }

  // 迁移表不是装饰：它是“这些列来自同一来源结构”的证据。缺失、为空、起手不是 baseline、
  // 出现清单外的迁移都必须拒绝——否则只凭列名相似就接受了一个来历不明的库。
  // 生成列存在的事实也意味着：任何 `SELECT *` 都会在非法 JSON 上求值 `json_extract`
  // 而报错，因此本文件只选显式列名。
  shapes.push(`seaql_migrations:audited(${verifyMigrationHistory(db)})`);

  return `${REINA_SCHEMA_PROFILE_ID}(${shapes.join(',')})`;
}

/**
 * 校验来源迁移历史，返回 `<baseline>..<latest>` 供 profile 使用。
 * 任一条件不满足都抛 `SCHEMA_UNSUPPORTED`：不按相似列猜语义，也不把未知版本当成“可以先试试”。
 */
function verifyMigrationHistory(db: Database.Database): string {
  const columns = db.prepare('PRAGMA table_xinfo(seaql_migrations)').all() as TableInfoRow[];
  if (columns.length === 0) {
    throw new ReinaAdapterError(
      'SCHEMA_UNSUPPORTED',
      '缺少 seaql_migrations 表：无法确认这些列来自已核对的迁移历史',
    );
  }
  if (!columns.some((column) => column.name === 'version')) {
    throw new ReinaAdapterError(
      'SCHEMA_UNSUPPORTED',
      'seaql_migrations 缺少 version 列，无法确认迁移历史',
    );
  }

  // 按 version 排序而不按 applied_at：version 是主键且 `m<日期>_<序号>` 定长，字典序即时间序；
  // applied_at 在不同 SeaORM 版本里可能是整数或文本，本文件不去猜它的类型。
  const rows = db.prepare('SELECT version FROM seaql_migrations ORDER BY version ASC').all() as {
    version?: unknown;
  }[];
  const versions: string[] = [];
  for (const row of rows) {
    const version = typeof row.version === 'string' ? row.version.trim() : '';
    if (version.length === 0) {
      throw new ReinaAdapterError(
        'SCHEMA_UNSUPPORTED',
        'seaql_migrations 含空版本行，无法确认迁移历史',
      );
    }
    versions.push(version);
  }
  if (versions.length === 0) {
    throw new ReinaAdapterError(
      'SCHEMA_UNSUPPORTED',
      'seaql_migrations 为空：无法确认来源结构版本，拒绝按相似列读取',
    );
  }

  const baseline = migrationName(versions[0]);
  if (baseline !== AUDITED_MIGRATIONS[0]) {
    throw new ReinaAdapterError(
      'SCHEMA_UNSUPPORTED',
      `起始迁移为 “${shortenVersion(baseline)}”，与已核对的 baseline ${AUDITED_MIGRATIONS[0]} 不一致：这不是已核对的 ReinaManager 迁移历史`,
    );
  }
  const unknown = versions.find((version) => !AUDITED_MIGRATION_SET.has(migrationName(version)));
  if (unknown !== undefined) {
    throw new ReinaAdapterError(
      'SCHEMA_UNSUPPORTED',
      `迁移 “${shortenVersion(migrationName(unknown))}” 不在已核对清单内（共 ${AUDITED_MIGRATIONS.length} 个，截至 ${
        AUDITED_MIGRATIONS[AUDITED_MIGRATIONS.length - 1]
      }）：来源可能已升级，请重新核对后再读取`,
    );
  }

  return `${baseline}..${migrationName(versions[versions.length - 1])}`;
}

/**
 * 只取迁移名的最后一段：SeaORM 用 `module_path!()` 的末段作版本名（即迁移文件 stem），
 * 个别版本可能写成 `migration::m2025...`；两种写法都要能认出同一个迁移。
 */
function migrationName(version: string): string {
  const separator = version.lastIndexOf('::');
  return separator >= 0 ? version.slice(separator + 2) : version;
}

/** 版本字符串写进错误消息时截短；诊断用，不进入 MCP 返回值。 */
function shortenVersion(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  let text: string | null = null;
  if (typeof value === 'string') {
    text = value;
  } else if (Buffer.isBuffer(value)) {
    text = value.toString('utf8');
  }
  if (text === null || text.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const item of value) {
    const text = readText(item);
    if (!text) continue;
    if (text.length > MAX_TAG_LENGTH) continue;
    tags.push(text);
  }
  return tags;
}

/** `bgm` 是 ReinaManager 对 Bangumi 的来源别名；其余 provider 不擅自归一。 */
function toKnownProvider(source: string): 'vndb' | 'bangumi' | null {
  const normalized = source.trim().toLowerCase();
  if (normalized === 'vndb') return 'vndb';
  if (normalized === 'bgm' || normalized === 'bangumi') return 'bangumi';
  return null;
}

function nameFromSource(row: SourceRow | undefined): string | null {
  if (!row) return null;
  const data = parseJsonObject(row.data);
  if (!data) return null;
  return readText(data.name_cn) ?? readText(data.name);
}

function buildGame(
  gameId: number,
  customData: unknown,
  sourceRows: readonly SourceRow[],
): ReinaGame {
  const custom = parseJsonObject(customData);
  const customName = custom ? readText(custom.name) : null;
  const customTags = custom ? readTags(custom.tags) : [];

  const known = new Map<'vndb' | 'bangumi', SourceRow>();
  const externalIds: ReinaGame['externalIds'] = [];
  const unsupportedTagProviders = new Set<string>();
  const sourceTags: Record<'vndb' | 'bangumi', string[]> = { vndb: [], bangumi: [] };

  for (const row of sourceRows) {
    const source = typeof row.source === 'string' ? row.source : '';
    const provider = toKnownProvider(source);
    if (!provider) {
      // 未核对的资料源不进 tags，也不能冒充 VNDB/Bangumi；只登记诊断。
      if (row.data !== null && row.data !== undefined) {
        unsupportedTagProviders.add(source.trim().toLowerCase() || '(empty)');
      }
      continue;
    }
    if (!known.has(provider)) known.set(provider, row);

    const externalId = readText(row.external_id);
    if (externalId) externalIds.push({ provider, id: externalId });

    const data = parseJsonObject(row.data);
    if (data) sourceTags[provider].push(...readTags(data.tags));
  }

  const seenExternal = new Set<string>();
  const dedupedExternalIds = externalIds
    .filter((entry) => {
      const key = `${entry.provider}\u0000${entry.id}`;
      if (seenExternal.has(key)) return false;
      seenExternal.add(key);
      return true;
    })
    .sort((left, right) =>
      left.provider === right.provider
        ? left.id.localeCompare(right.id)
        : left.provider.localeCompare(right.provider),
    );

  const tags: ReinaTag[] = [];
  const seenTags = new Set<string>();
  const buckets: readonly [ReinaProvider, readonly string[]][] = [
    ['custom', customTags],
    ['bangumi', sourceTags.bangumi],
    ['vndb', sourceTags.vndb],
  ];
  collectTags: for (const [provider, names] of buckets) {
    for (const name of names) {
      const key = `${provider}\u0000${name}`;
      if (seenTags.has(key)) continue;
      if (tags.length >= MAX_TAGS_PER_GAME) break collectTags;
      seenTags.add(key);
      tags.push({ name, provider });
    }
  }

  const displayName =
    customName ??
    nameFromSource(known.get('bangumi')) ??
    nameFromSource(known.get('vndb')) ??
    `未命名作品（${gameId}）`;

  return {
    id: gameId,
    name: displayName,
    externalIds: dedupedExternalIds,
    tags,
    unsupportedTagProviders: [...unsupportedTagProviders].sort(),
  };
}

function isEpochSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_EPOCH_SECONDS
  );
}

function toIsoTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * 只接受可解释的行；任何字段缺失/类型不符/时间倒序/非正时长都让整次读取失败，
 * 而不是补 0、猜值或跳过——跳过会让累计时长看起来完整却少了一段。
 */
function toSession(row: SessionRow): ReinaSession | null {
  const { session_id: sessionId, game_id: gameId, start_time, end_time, duration, date } = row;
  if (typeof sessionId !== 'number' || !Number.isInteger(sessionId) || sessionId <= 0) return null;
  if (typeof gameId !== 'number' || !Number.isInteger(gameId) || gameId <= 0) return null;
  if (!isEpochSeconds(start_time) || !isEpochSeconds(end_time)) return null;
  if (end_time < start_time) return null;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0) return null;

  const sourceDate = typeof date === 'string' ? date.trim() : '';
  if (sourceDate.length === 0 || sourceDate.length > MAX_SOURCE_DATE_LENGTH) return null;

  const recordedDurationSeconds = duration * 60;
  if (!Number.isSafeInteger(recordedDurationSeconds)) return null;

  return {
    id: sessionId,
    gameId,
    startTime: toIsoTimestamp(start_time),
    endTime: toIsoTimestamp(end_time),
    sourceDate,
    recordedMinutes: duration,
    recordedDurationSeconds,
    durationPrecision: 'minute-rounded',
    trackingMode: 'unknown',
    recordKind: 'unknown',
  };
}

function parseInstant(value: string, field: string): number {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    throw new ReinaAdapterError(
      'INVALID_INPUT',
      `${field} 必须是带 Z 或显式时区偏移的完整 ISO 时间（例如 2026-10-20T00:00:00+08:00）`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new ReinaAdapterError('INVALID_INPUT', `${field} 不是可解析的时间`);
  }
  return milliseconds;
}

/**
 * 半开区间 [from, to)，按会话 `start_time` 过滤。`start_time` 是整数秒，
 * 因此用 ceil(ms/1000) 精确表达“毫秒边界不得被整数秒跨越”。
 */
function parseRange(from: string | undefined, to: string | undefined): TimeRange {
  if (from === undefined && to === undefined) return NO_RANGE;
  if (from === undefined || to === undefined) {
    throw new ReinaAdapterError('INVALID_INPUT', 'from 与 to 必须成对提供');
  }
  const fromMs = parseInstant(from, 'from');
  const toMs = parseInstant(to, 'to');
  if (!(fromMs < toMs)) {
    throw new ReinaAdapterError('INVALID_INPUT', 'from 必须早于 to');
  }
  return { fromSec: Math.ceil(fromMs / 1000), toSec: Math.ceil(toMs / 1000) };
}

function requireGameId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ReinaAdapterError('INVALID_INPUT', 'gameId 必须是正整数');
  }
  return value;
}

function buildStats(source: StatsRow | null, sessions: readonly ReinaSession[]): ReinaStats {
  let sessionTotalMinutes = 0;
  for (const session of sessions) {
    sessionTotalMinutes += session.recordedMinutes;
    if (!Number.isSafeInteger(sessionTotalMinutes)) {
      throw new ReinaAdapterError('DATA_LIMIT_EXCEEDED', '会话累计分钟数超出安全整数范围');
    }
  }

  return {
    // 来源汇总可空；缺失返回 null，绝不显示 0。
    sourceTotalMinutes:
      source && typeof source.total_time === 'number' && Number.isSafeInteger(source.total_time) && source.total_time >= 0
        ? source.total_time
        : null,
    sourceSessionCount:
      source &&
      typeof source.session_count === 'number' &&
      Number.isSafeInteger(source.session_count) &&
      source.session_count >= 0
        ? source.session_count
        : null,
    sourceLastPlayed: source && isEpochSeconds(source.last_played) ? toIsoTimestamp(source.last_played) : null,
    sessionTotalMinutes,
    sessionCount: sessions.length,
    liveSession: false,
  };
}

export class ReinaAdapter {
  readonly #filePath: string;
  #db: Database.Database | null;
  #schemaProfile: string;

  constructor(filePath: string) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new ReinaAdapterError('INVALID_INPUT', '必须提供 ReinaManager 数据库文件路径');
    }

    let resolvedPath: string;
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new ReinaAdapterError('INVALID_INPUT', '所选路径不是普通文件');
      }
      // 规范化为真实路径，避免同一个库经符号链接/短路径别名被当成两个来源。
      resolvedPath = fs.realpathSync(filePath);
    } catch (error) {
      if (error instanceof ReinaAdapterError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // 关键：只读适配器绝不创建数据库文件。
        throw new ReinaAdapterError('SOURCE_NOT_FOUND', '找不到所选的 ReinaManager 数据库文件');
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new ReinaAdapterError('PERMISSION_DENIED', '没有读取该数据库文件的权限');
      }
      throw toAdapterError(error);
    }

    this.#filePath = resolvedPath;
    this.#db = null;
    this.#schemaProfile = '';

    let db: Database.Database | null = null;
    try {
      db = new Database(resolvedPath, { readonly: true, fileMustExist: true });
      db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
      // 连接级只读兜底：即使后续代码误写 SQL 也会被 SQLite 拒绝，且不改动源文件状态。
      db.pragma('query_only = ON');
      const queryOnly = db.pragma('query_only', { simple: true });
      if (queryOnly !== 1) {
        throw new ReinaAdapterError(
          'SCHEMA_UNSUPPORTED',
          'SQLite 未接受 query_only 设置，无法保证只读查询，已拒绝连接',
        );
      }
      this.#schemaProfile = verifySchema(db);
      this.#db = db;
    } catch (error) {
      if (db) {
        try {
          db.close();
        } catch {
          // 关闭失败不影响抛出原始错误。
        }
      }
      throw toAdapterError(error);
    }
  }

  /** 已核对的 schema profile 与能力声明；`liveSession` 恒为 false（库中无未结束会话）。 */
  connection(): ReinaConnection {
    this.#database();
    return { schemaProfile: this.#schemaProfile, readable: true, liveSession: false };
  }

  /** 作品目录：名称按 custom → Bangumi → VNDB 规则解析，标签只来自三种已核对 provider。 */
  games(): ReinaGame[] {
    const db = this.#database();

    const gameRows = db.prepare(SQL_SELECT_GAMES).all({ limit: MAX_GAMES + 1 }) as GameRow[];
    if (gameRows.length > MAX_GAMES) {
      throw new ReinaAdapterError(
        'DATA_LIMIT_EXCEEDED',
        `源库作品数量超过桥接上限 ${MAX_GAMES}；首版目录查询不支持更大范围`,
      );
    }

    const sourceRows = db.prepare(SQL_SELECT_SOURCES).all({ limit: MAX_SOURCE_ROWS + 1 }) as SourceRow[];
    if (sourceRows.length > MAX_SOURCE_ROWS) {
      throw new ReinaAdapterError(
        'DATA_LIMIT_EXCEEDED',
        '源库资料行数量异常，无法在单次有界读取中完成',
      );
    }

    const sourcesByGame = new Map<number, SourceRow[]>();
    for (const row of sourceRows) {
      if (typeof row.game_id !== 'number' || !Number.isInteger(row.game_id) || row.game_id <= 0) continue;
      const list = sourcesByGame.get(row.game_id);
      if (list) {
        list.push(row);
      } else {
        sourcesByGame.set(row.game_id, [row]);
      }
    }

    const games: ReinaGame[] = [];
    for (const row of gameRows) {
      if (typeof row.id !== 'number' || !Number.isInteger(row.id) || row.id <= 0) continue;
      games.push(buildGame(row.id, row.custom_data, sourcesByGame.get(row.id) ?? []));
    }
    return games;
  }

  /** 有序会话；`duration` 是分钟，`recordedDurationSeconds` 是其规范化结果，不增加精度。 */
  sessions(gameId: number, from?: string, to?: string): ReinaSession[] {
    const db = this.#database();
    const id = requireGameId(gameId);
    const range = parseRange(from, to);
    return this.#loadSessions(db, id, range);
  }

  /** 来源汇总 + 会话派生累计，二者分开返回，绝不相加或互相替代。 */
  stats(gameId: number): ReinaStats {
    const db = this.#database();
    const id = requireGameId(gameId);
    return db.transaction((): ReinaStats => {
      const source = this.#readStatsRow(db, id);
      const sessions = this.#loadSessions(db, id, NO_RANGE);
      return buildStats(source, sessions);
    })();
  }

  /**
   * 会话与统计来自同一短只读事务；超出 50,000 行、16MiB，或遇到无法解释的会话行时显式失败。
   * 不做“跳过坏行、返回其余部分”的降级：上层没有可消费的 rejected 通道，跳过会把不完整的
   * 累计伪装成完整结果。
   */
  snapshot(gameId: number, from?: string, to?: string): ReinaSnapshot {
    const db = this.#database();
    const id = requireGameId(gameId);
    const range = parseRange(from, to);
    return db.transaction((): ReinaSnapshot => {
      const source = this.#readStatsRow(db, id);
      const sessions = this.#loadSessions(db, id, range);
      return { sessions, stats: buildStats(source, sessions) };
    })();
  }

  close(): void {
    const db = this.#db;
    this.#db = null;
    if (db) {
      try {
        db.close();
      } catch {
        // 幂等收尾：已关闭的句柄不再抛给调用方。
      }
    }
  }

  /** 供诊断使用（不进入 MCP 返回值）。 */
  get filePath(): string {
    return this.#filePath;
  }

  #database(): Database.Database {
    if (!this.#db) {
      throw new ReinaAdapterError('NOT_CONNECTED', 'ReinaManager 连接已关闭');
    }
    return this.#db;
  }

  #readStatsRow(db: Database.Database, gameId: number): StatsRow | null {
    const row = db.prepare(SQL_SELECT_STATS).get({ gameId }) as StatsRow | undefined;
    return row ?? null;
  }

  #loadSessions(db: Database.Database, gameId: number, range: TimeRange): ReinaSession[] {
    const rows = db.prepare(SQL_SELECT_SESSIONS).all({
      gameId,
      fromSec: range.fromSec,
      toSec: range.toSec,
      limit: MAX_SESSION_ROWS + 1,
    }) as SessionRow[];

    if (rows.length > MAX_SESSION_ROWS) {
      throw new ReinaAdapterError(
        'DATA_LIMIT_EXCEEDED',
        `单次读取超过 ${MAX_SESSION_ROWS} 条会话；请缩小时间范围后再查询`,
      );
    }

    const sessions: ReinaSession[] = [];
    for (const row of rows) {
      const session = toSession(row);
      if (!session) {
        // 跳过非法行会让累计时长看起来完整却少一段，且 MCP 层没有可消费的 rejected 通道，
        // 因此这里明确失败，让调用方看到“读不出来”而不是“读少了一段”。
        throw new ReinaAdapterError(
          'SCHEMA_UNSUPPORTED',
          `会话行（session_id=${
            typeof row.session_id === 'number' ? row.session_id : '未知'
          }）不满足已核对的不变量：时间戳须为整数秒、end_time 不得早于 start_time、duration 须为正整数分钟、date 须非空`,
        );
      }
      sessions.push(session);
    }

    const bytes = Buffer.byteLength(JSON.stringify(sessions), 'utf8');
    if (bytes > MAX_SNAPSHOT_BYTES) {
      throw new ReinaAdapterError(
        'DATA_LIMIT_EXCEEDED',
        `快照数据超过 ${Math.floor(MAX_SNAPSHOT_BYTES / (1024 * 1024))}MiB 上限；请缩小时间范围`,
      );
    }

    return sessions;
  }
}
