/**
 * ReinaManager 只读适配器的合成测试。
 *
 * 全部用例在系统临时目录内自建 SQLite 文件（列定义与
 * docs/reina-mcp-source-evidence.md 中 sea-orm-codegen 实体一致），
 * 绝不读取任何真实用户库，也不写入仓库内路径。
 *
 * 无法验证的语义（计时模式、前台有效时长、跨日分摊）不在此断言：
 * 适配器对它们只做保守表达（`trackingMode: 'unknown'`、分钟粒度）
 * 和显式拒绝（未知 schema），测试只断言这两件事。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_GAMES,
  MAX_SESSION_ROWS,
  ReinaAdapter,
  ReinaAdapterError,
  type ReinaErrorCode,
} from '../../src/main/reina/adapter';

/**
 * 与 ReinaManager 最终 schema 一致的建表语句（含 seaql_migrations 诊断表）。
 *
 * 逐条来自 `src-tauri/migration/src`：
 * - `games` 最终 17 列 = 16 个普通列 + 1 个 VIRTUAL 生成列 `user_rating`
 *   （m20260706_000014 添加 `GENERATED ALWAYS AS (CAST(json_extract(custom_data,'$.user_rating') AS REAL)) VIRTUAL`）；
 * - `game_sessions` 最终 6 列（m20260505_000010 删掉 created_at）；
 * - `game_statistics` 5 列；
 * - `game_sources` 6 列 = 4 个普通列 + VIRTUAL 生成列 `score`/`rank`，含真实 CHECK 与复合主键。
 * 生成列必须保留：`PRAGMA table_info` 会漏掉它们而 `table_xinfo` 不会，这直接决定 profile 里的列数。
 *
 * `generatedColumns: false` 是同一份已核对必需列布局去掉生成列：生成列在 INSERT 时就会求值
 * `json_extract`，所以“库里已经躺着坏 JSON”这种情形只能在无生成列的 fixture 上构造
 * （对照用例 `真实生成列会在写入时就拒绝坏 JSON`）。两条 DDL 共用一份源码，避免各自漂移。
 */
function buildSchemaSql({ generatedColumns = true }: { generatedColumns?: boolean } = {}): string {
  const userRating = generatedColumns
    ? `    user_rating REAL GENERATED ALWAYS AS (
      CAST(json_extract(custom_data, '$.user_rating') AS REAL)
    ) VIRTUAL,
`
    : '';
  const sourceGenerated = generatedColumns
    ? `    score REAL GENERATED ALWAYS AS (
      CAST(json_extract(data, '$.score') AS REAL)
    ) VIRTUAL,
    rank INTEGER GENERATED ALWAYS AS (
      CAST(json_extract(data, '$.rank') AS INTEGER)
    ) VIRTUAL,
`
    : '';
  return `
  CREATE TABLE games (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    id_type TEXT NOT NULL,
    date TEXT,
    localpath TEXT,
    executable TEXT,
    launch_type TEXT NOT NULL DEFAULT 'local',
    steam_launch_id TEXT,
    savepath TEXT,
    autosave INTEGER,
    maxbackups INTEGER,
    clear INTEGER,
    le_launch INTEGER,
    magpie INTEGER,
    custom_data TEXT,
${userRating}    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE game_sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );
  CREATE TABLE game_statistics (
    game_id INTEGER PRIMARY KEY,
    total_time INTEGER,
    session_count INTEGER,
    last_played INTEGER,
    daily_stats TEXT,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );
  CREATE TABLE game_sources (
    game_id INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (trim(source) <> ''),
    external_id TEXT,
    data TEXT,
${sourceGenerated}    PRIMARY KEY (game_id, source),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    CHECK (external_id IS NOT NULL OR data IS NOT NULL),
    CHECK (data IS NULL OR json_valid(data))
  );
  CREATE TABLE seaql_migrations (
    version TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
`;
}

const SCHEMA_SQL = buildSchemaSql();
/** 同一份已核对必需列布局但不含 VIRTUAL 生成列；只用于构造“坏 JSON 已经在库里”的 fixture。 */
const SCHEMA_WITHOUT_GENERATED_SQL = buildSchemaSql({ generatedColumns: false });

/**
 * 来源真实的迁移历史（逐条转录自 `src-tauri/migration/src/lib.rs:4-24`，顺序即应用顺序）。
 * 刻意不复用 `adapter.ts` 内部清单：两边不一致时测试必须失败，而不是共用一份抄错的名单。
 */
const REAL_MIGRATIONS: readonly string[] = [
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
];

type SessionSeed = [id: number, gameId: number, start: number, end: number, duration: number, date: string];

let tempDir = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reina-adapter-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function dbPath(name = 'reina_manager.db'): string {
  return path.join(tempDir, name);
}

/** 写入迁移历史（默认取真实清单），让 fixture 带上来来源出处。 */
function insertMigrations(db: Database.Database, versions: readonly string[] = REAL_MIGRATIONS): void {
  const statement = db.prepare('INSERT INTO seaql_migrations (version, applied_at) VALUES (?, ?)');
  for (const [index, version] of versions.entries()) {
    statement.run(version, 1_700_000_000 + index);
  }
}

interface CreateDbOptions {
  /** `false` = 只建表、不写迁移历史，模拟“列名相同但没有来源出处”的库。 */
  migrations?: readonly string[] | false;
  /**
   * `false` = 用不含 VIRTUAL 生成列的同一份必需列布局建库。
   * 生成列在 INSERT 时就会求值 `json_extract`，坏 JSON 根本写不进去，
   * 所以“库里已存在坏行”的 fixture 只能这样构造。
   */
  generatedColumns?: boolean;
}

/** 建一个合成库并关闭写入连接；默认按真实来源写入完整迁移历史。返回文件路径。 */
function createDb(
  name = 'reina_manager.db',
  seed?: (db: Database.Database) => void,
  options: CreateDbOptions = {},
): string {
  const file = dbPath(name);
  const db = new Database(file);
  db.pragma('journal_mode = DELETE');
  db.exec(options.generatedColumns === false ? SCHEMA_WITHOUT_GENERATED_SQL : SCHEMA_SQL);
  const migrations = options.migrations === undefined ? REAL_MIGRATIONS : options.migrations;
  if (migrations !== false) {
    db.transaction(() => insertMigrations(db, migrations))();
  }
  if (seed) {
    db.transaction(() => seed(db))();
  }
  db.close();
  return file;
}

function insertGame(db: Database.Database, id: number, customData: unknown = null): void {
  db.prepare('INSERT INTO games (id, id_type, launch_type, custom_data) VALUES (?, ?, ?, ?)').run(
    id,
    'manual',
    'normal',
    customData === null ? null : JSON.stringify(customData),
  );
}

/** 直接写入原始 custom_data 文本，用于构造损坏 JSON。 */
function insertGameRawData(db: Database.Database, id: number, raw: string | null): void {
  db.prepare('INSERT INTO games (id, id_type, launch_type, custom_data) VALUES (?, ?, ?, ?)').run(
    id,
    'manual',
    'normal',
    raw,
  );
}

function insertSource(
  db: Database.Database,
  gameId: number,
  source: string,
  externalId: string | null = null,
  data: unknown = null,
): void {
  db.prepare('INSERT INTO game_sources (game_id, source, external_id, data) VALUES (?, ?, ?, ?)').run(
    gameId,
    source,
    externalId,
    data === null ? null : JSON.stringify(data),
  );
}

function insertSession(
  db: Database.Database,
  id: number,
  gameId: number,
  start: number,
  end: number,
  duration: number,
  date = '1970-01-01',
): void {
  db.prepare(
    'INSERT INTO game_sessions (session_id, game_id, start_time, end_time, duration, date) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, gameId, start, end, duration, date);
}

function insertManySessions(db: Database.Database, rows: readonly SessionSeed[]): void {
  const statement = db.prepare(
    'INSERT INTO game_sessions (session_id, game_id, start_time, end_time, duration, date) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    statement.run(row[0], row[1], row[2], row[3], row[4], row[5]);
  }
}

function insertStats(
  db: Database.Database,
  gameId: number,
  totalTime: number | null,
  sessionCount: number | null,
  lastPlayed: number | null,
): void {
  db.prepare(
    'INSERT INTO game_statistics (game_id, total_time, session_count, last_played) VALUES (?, ?, ?, ?)',
  ).run(gameId, totalTime, sessionCount, lastPlayed);
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function expectAdapterError(run: () => unknown, code: ReinaErrorCode): ReinaAdapterError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ReinaAdapterError);
  const adapterError = caught as ReinaAdapterError;
  expect(adapterError.code).toBe(code);
  return adapterError;
}

describe('ReinaAdapter 连接与 schema 核对', () => {
  it('兼容 NextMoe 第 22 次迁移，保留分钟统计并且不修改来源', () => {
    const file = createDb('nextmoe-22.db', (db) => {
      // Synthetic post-migration layout: OAuth storage and detached Kun IDs
      // do not change the play-session columns or recorded duration units.
      db.exec('CREATE TABLE user (id INTEGER PRIMARY KEY, nextmoe_auth TEXT)');
      insertGame(db, 1, { name: '合成作品' });
      insertSource(db, 1, 'kun', null, { name: '保留的资料快照' });
      insertSession(db, 1, 1, 1000, 4600, 12);
      insertStats(db, 1, 99, 3, 4600);
    }, { migrations: [...REAL_MIGRATIONS, 'm20261006_000022_nextmoe_oauth'] });
    const before = fs.readFileSync(file);
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.connection()).toMatchObject({ readable: true, liveSession: false });
      expect(adapter.connection().schemaProfile).toContain('m20261006_000022_nextmoe_oauth');
      expect(adapter.games()).toEqual([expect.objectContaining({ id: 1, name: '合成作品' })]);
      expect(adapter.sessions(1)).toEqual([expect.objectContaining({ recordedMinutes: 12, recordedDurationSeconds: 720 })]);
      expect(adapter.stats(1)).toMatchObject({ sourceTotalMinutes: 99, sessionTotalMinutes: 12 });
    } finally {
      adapter.close();
    }
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it('报告已核对的 schema profile 与只读能力', () => {
    const adapter = new ReinaAdapter(createDb());
    try {
      const connection = adapter.connection();
      expect(connection.readable).toBe(true);
      expect(connection.liveSession).toBe(false);
      expect(connection.schemaProfile).toContain('reinamanager.v1');
      expect(connection.schemaProfile).toContain('games:17');
      expect(connection.schemaProfile).toContain('game_sessions:6');
      expect(connection.schemaProfile).toContain('game_statistics:5');
      expect(connection.schemaProfile).toContain('game_sources:6');
      expect(connection.schemaProfile).toContain(
        'seaql_migrations:audited(m20250927_000001_baseline_migration..m20260923_000021_tool_integration_defaults)',
      );
    } finally {
      adapter.close();
    }
  });

  it('文件不存在时报 SOURCE_NOT_FOUND，且绝不创建数据库文件', () => {
    const missing = dbPath('missing.db');
    expect(fs.existsSync(missing)).toBe(false);
    expectAdapterError(() => new ReinaAdapter(missing), 'SOURCE_NOT_FOUND');
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('传入目录时报 INVALID_INPUT', () => {
    expectAdapterError(() => new ReinaAdapter(tempDir), 'INVALID_INPUT');
  });

  it('传入非 SQLite 文件时报 SCHEMA_UNSUPPORTED，不改动该文件', () => {
    const file = dbPath('notes.db');
    const content = 'this file is not a sqlite database at all';
    fs.writeFileSync(file, content);
    expectAdapterError(() => new ReinaAdapter(file), 'SCHEMA_UNSUPPORTED');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  });

  it('缺少关键列（duration/date）时拒绝读取，而不是猜单位', () => {
    const file = dbPath('old-layout.db');
    const db = new Database(file);
    db.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY, custom_data TEXT);
      CREATE TABLE game_sessions (
        session_id INTEGER PRIMARY KEY,
        game_id INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL
      );
      CREATE TABLE game_statistics (game_id INTEGER PRIMARY KEY, total_time INTEGER, session_count INTEGER, last_played INTEGER);
      CREATE TABLE game_sources (game_id INTEGER NOT NULL, source TEXT NOT NULL, external_id TEXT, data TEXT, PRIMARY KEY (game_id, source));
    `);
    db.close();
    expectAdapterError(() => new ReinaAdapter(file), 'SCHEMA_UNSUPPORTED');
  });

  it('主键与已核对布局不一致时拒绝读取', () => {
    const file = dbPath('wrong-pk.db');
    const db = new Database(file);
    db.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY, custom_data TEXT);
      CREATE TABLE game_sessions (
        session_id INTEGER,
        game_id INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        date TEXT NOT NULL
      );
      CREATE TABLE game_statistics (game_id INTEGER PRIMARY KEY, total_time INTEGER, session_count INTEGER, last_played INTEGER);
      CREATE TABLE game_sources (game_id INTEGER NOT NULL, source TEXT NOT NULL, external_id TEXT, data TEXT, PRIMARY KEY (game_id, source));
    `);
    db.close();
    expectAdapterError(() => new ReinaAdapter(file), 'SCHEMA_UNSUPPORTED');
  });

  it('额外列不影响读取，profile 反映真实列数', () => {
    const file = createDb('extra-column.db', (db) => {
      db.exec('ALTER TABLE games ADD COLUMN future_column TEXT');
      insertGame(db, 1, { name: '带额外列的作品' });
    });
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.connection().schemaProfile).toContain('games:18');
      expect(adapter.games()).toEqual([
        expect.objectContaining({ id: 1, name: '带额外列的作品' }),
      ]);
    } finally {
      adapter.close();
    }
  });

  it('列名相同但缺迁移表、迁移表为空或缺 baseline 时拒绝读取', () => {
    // ① 表结构逐列一致，但没有 seaql_migrations：无法证明这些列来自 ReinaManager。
    const noHistory = createDb('no-migration-table.db', (db) => {
      db.exec('DROP TABLE seaql_migrations');
    });
    expectAdapterError(() => new ReinaAdapter(noHistory), 'SCHEMA_UNSUPPORTED');

    // ② 迁移表存在但没有任何行：同样是“不知道来自哪一版”。
    const emptyHistory = createDb('empty-migration.db', undefined, { migrations: false });
    expectAdapterError(() => new ReinaAdapter(emptyHistory), 'SCHEMA_UNSUPPORTED');

    // ③ 起手迁移不是已核对的 baseline：更像别的应用用了同名列。
    const noBaseline = createDb('no-baseline.db', undefined, {
      migrations: REAL_MIGRATIONS.slice(1),
    });
    expectAdapterError(() => new ReinaAdapter(noBaseline), 'SCHEMA_UNSUPPORTED');
  });

  it('清单外的迁移被拒绝，清单内的较早版本被接受且 profile 记录区间', () => {
    const unknownLatest = createDb('future-migration.db', undefined, {
      migrations: [...REAL_MIGRATIONS, 'm20990101_000022_future_migration'],
    });
    expectAdapterError(() => new ReinaAdapter(unknownLatest), 'SCHEMA_UNSUPPORTED');

    // 版本名带 crate 前缀（`migration::m2025...`）时仍认得出是同一批迁移。
    const prefixed = new ReinaAdapter(
      createDb('prefixed-versions.db', undefined, {
        migrations: REAL_MIGRATIONS.map((version) => `migration::${version}`),
      }),
    );
    try {
      expect(prefixed.connection().schemaProfile).toContain(
        'seaql_migrations:audited(m20250927_000001_baseline_migration..m20260923_000021_tool_integration_defaults)',
      );
    } finally {
      prefixed.close();
    }

    // 停在 000019 的库：读取的列与最新版一致，属于已核对清单，接受并如实标注区间。
    const earlier = new ReinaAdapter(
      createDb('migrated-to-19.db', undefined, { migrations: REAL_MIGRATIONS.slice(0, 19) }),
    );
    try {
      expect(earlier.connection().schemaProfile).toContain(
        'seaql_migrations:audited(m20250927_000001_baseline_migration..m20260809_000019_add_steam_launch)',
      );
    } finally {
      earlier.close();
    }
  });

  it('真实生成列在写入时就拒绝坏 JSON：坏行只能来自没有生成列的布局', () => {
    const file = dbPath('generated-writes.db');
    const db = new Database(file);
    try {
      db.exec(SCHEMA_SQL);
      // games.user_rating 是 `json_extract(custom_data, '$.user_rating')` 的 VIRTUAL 生成列：
      // 求值发生在写入这一行时，所以坏 JSON 连 INSERT 都过不去 —— 这也说明“坏行 + 生成列”
      // 在真实 SQLite 里不可共存，验证适配器容忍坏行只能用下面那个无生成列的 fixture。
      expect(() => insertGameRawData(db, 1, '{oops')).toThrow(/json/i);
      expect(db.prepare('SELECT COUNT(*) AS count FROM games').get()).toEqual({ count: 0 });

      // 合法 JSON 可以写入；此时 `SELECT *` 会顺带求值生成列，这正是适配器只选显式列名的原因。
      insertGame(db, 1, { name: '正常作品', user_rating: 8 });
      expect(db.prepare('SELECT user_rating FROM games WHERE id = 1').get()).toEqual({
        user_rating: 8,
      });
    } finally {
      db.close();
    }
  });

  it('必需列相同但没有生成列的库：一行坏 JSON 不会让整表不可读', () => {
    const file = createDb(
      'generated.db',
      (db) => {
        insertGameRawData(db, 1, '{oops');
        insertGame(db, 2, { name: '正常作品' });
        insertSource(db, 2, 'bgm', '1', { name: '正常作品', score: 8.5, rank: 12 });
      },
      { generatedColumns: false },
    );

    const adapter = new ReinaAdapter(file);
    try {
      const games = adapter.games();
      expect(games).toEqual([
        expect.objectContaining({ id: 1, name: '未命名作品（1）', tags: [] }),
        expect.objectContaining({ id: 2, name: '正常作品', tags: [] }),
      ]);
    } finally {
      adapter.close();
    }
  });
});

describe('ReinaAdapter 作品与标签解析', () => {
  it('按 custom → Bangumi → VNDB 规则取显示名，缺失时用占位名', () => {
    const file = createDb('names.db', (db) => {
      insertGame(db, 1, { name: '自定义名' });
      insertSource(db, 1, 'bgm', '100', { name: 'Bgm原名', name_cn: 'Bgm中文名' });
      insertGame(db, 2);
      insertSource(db, 2, 'bgm', '200', { name: 'Bgm原名二', name_cn: 'Bgm中文名二' });
      insertGame(db, 3);
      insertSource(db, 3, 'bgm', '300', { name: 'Bgm无中文名' });
      insertGame(db, 4);
      insertSource(db, 4, 'vndb', 'v400', { name: 'VNDB原名', name_cn: 'VNDB中文名' });
      insertGame(db, 5);
      insertSource(db, 5, 'vndb', 'v500', { name: 'VNDB只有原名' });
      insertGame(db, 6);
    });
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.games().map((game) => [game.id, game.name])).toEqual([
        [1, '自定义名'],
        [2, 'Bgm中文名二'],
        [3, 'Bgm无中文名'],
        [4, 'VNDB中文名'],
        [5, 'VNDB只有原名'],
        [6, '未命名作品（6）'],
      ]);
    } finally {
      adapter.close();
    }
  });

  it('bgm 归一化为 bangumi，并提取来源外链 ID', () => {
    const file = createDb('providers.db', (db) => {
      insertGame(db, 1);
      insertSource(db, 1, 'bgm', '1234', { name: 'Bgm作品' });
      insertSource(db, 1, 'vndb', 'v99', { name: 'Vndb作品' });
    });
    const adapter = new ReinaAdapter(file);
    try {
      const game = adapter.games()[0];
      expect(game.externalIds).toEqual([
        { provider: 'bangumi', id: '1234' },
        { provider: 'vndb', id: 'v99' },
      ]);
    } finally {
      adapter.close();
    }
  });

  it('标签只取 custom/bangumi/vndb，其他来源只登记诊断', () => {
    const file = createDb('tags.db', (db) => {
      insertGame(db, 1, { tags: ['自制标签'] });
      insertSource(db, 1, 'bgm', '1', { name: '作品', tags: ['纯爱', '泣きゲー'] });
      insertSource(db, 1, 'vndb', 'v1', { name: '作品', tags: ['Science Fiction'] });
      insertSource(db, 1, 'ymgal', 'y1', { name: '作品', tags: ['不应出现的标签'] });
      insertSource(db, 1, 'hikarinagi', 'h1', { name: '作品', tags: ['也不应出现'] });
    });
    const adapter = new ReinaAdapter(file);
    try {
      const game = adapter.games()[0];
      expect(game.tags).toEqual([
        { name: '自制标签', provider: 'custom' },
        { name: '纯爱', provider: 'bangumi' },
        { name: '泣きゲー', provider: 'bangumi' },
        { name: 'Science Fiction', provider: 'vndb' },
      ]);
      expect(game.unsupportedTagProviders).toEqual(['hikarinagi', 'ymgal']);
    } finally {
      adapter.close();
    }
  });

  it('同 provider 内标签去重，超长标签丢弃，不同 provider 的同名标签保留', () => {
    const file = createDb('tag-hygiene.db', (db) => {
      insertGame(db, 1, { tags: ['纯爱', '纯爱', '', '  '] });
      insertSource(db, 1, 'bgm', '1', {
        name: '作品',
        tags: ['纯爱', '纯爱', 'x'.repeat(201), 42, null],
      });
    });
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.games()[0].tags).toEqual([
        { name: '纯爱', provider: 'custom' },
        { name: '纯爱', provider: 'bangumi' },
      ]);
    } finally {
      adapter.close();
    }
  });

  it('custom_data 损坏时回退到来源名且不抛错', () => {
    // 坏 JSON 只能写进没有生成列的布局（见 `真实生成列在写入时就拒绝坏 JSON`）。
    const file = createDb(
      'broken-custom.db',
      (db) => {
        insertGameRawData(db, 1, '{"name": 这不是 JSON');
        insertSource(db, 1, 'bgm', '1', { name: '回退名' });
        insertGameRawData(db, 2, '[]');
        insertGameRawData(db, 3, null);
      },
      { generatedColumns: false },
    );
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.games().map((game) => game.name)).toEqual(['回退名', '未命名作品（2）', '未命名作品（3）']);
    } finally {
      adapter.close();
    }
  });

  it('没有任何资料时的空库返回空目录而不是抛错', () => {
    const adapter = new ReinaAdapter(createDb('empty.db'));
    try {
      expect(adapter.games()).toEqual([]);
    } finally {
      adapter.close();
    }
  });

  it(`作品数超过 ${MAX_GAMES} 时显式失败而不是截断`, () => {
    const file = createDb('too-many-games.db', (db) => {
      const statement = db.prepare(
        'INSERT INTO games (id, id_type, launch_type, custom_data) VALUES (?, ?, ?, ?)',
      );
      for (let id = 1; id <= MAX_GAMES + 1; id += 1) {
        statement.run(id, 'manual', 'normal', null);
      }
    });
    const adapter = new ReinaAdapter(file);
    try {
      expectAdapterError(() => adapter.games(), 'DATA_LIMIT_EXCEEDED');
    } finally {
      adapter.close();
    }
  });
});

describe('ReinaAdapter 会话读取', () => {
  it('按 start_time 倒序、session_id 倒序稳定排序，并把分钟换算为秒级规范值', () => {
    const file = createDb('sessions.db', (db) => {
      insertGame(db, 1);
      insertSession(db, 11, 1, 1_700_000_000, 1_700_001_800, 30, '2023-11-15');
      insertSession(db, 12, 1, 1_700_002_000, 1_700_003_800, 30, '2023-11-15');
      insertSession(db, 13, 1, 1_700_002_000, 1_700_004_000, 33, '2023-11-15');
    });
    const adapter = new ReinaAdapter(file);
    try {
      const sessions = adapter.sessions(1);
      expect(sessions.map((session) => session.id)).toEqual([13, 12, 11]);
      expect(sessions[0]).toEqual({
        id: 13,
        gameId: 1,
        startTime: iso(1_700_002_000),
        endTime: iso(1_700_004_000),
        sourceDate: '2023-11-15',
        recordedMinutes: 33,
        recordedDurationSeconds: 33 * 60,
        durationPrecision: 'minute-rounded',
        trackingMode: 'unknown',
        recordKind: 'unknown',
      });
    } finally {
      adapter.close();
    }
  });

  it('duration 是分钟口径，绝不用 end_time - start_time 替代', () => {
    const file = createDb('duration-semantics.db', (db) => {
      insertGame(db, 1);
      // 自然跨度 4000 秒，但来源只记录 30 分钟前台有效时长。
      insertSession(db, 1, 1, 1_700_000_000, 1_700_004_000, 30, '2023-11-15');
    });
    const adapter = new ReinaAdapter(file);
    try {
      const [session] = adapter.sessions(1);
      expect(session.recordedMinutes).toBe(30);
      expect(session.recordedDurationSeconds).toBe(1800);
      expect(session.recordedDurationSeconds).not.toBe(4000);
    } finally {
      adapter.close();
    }
  });

  it('遇到无法解释的会话行时整次读取失败，而不是跳过并伪装完整累计', () => {
    const file = createDb('invalid-rows.db', (db) => {
      insertGame(db, 1);
      insertSession(db, 1, 1, 1_700_000_000, 1_700_001_800, 30, '2023-11-15'); // 合法
      insertSession(db, 2, 1, 1_700_002_000, 1_700_001_000, 5, '2023-11-15'); // end < start
      insertSession(db, 3, 1, 1_700_002_000, 1_700_002_600, 0, '2023-11-15'); // 非正时长
      insertSession(db, 4, 1, 1_700_002_000, 1_700_002_600, 10, ''); // 空 date
      insertSession(db, 5, 1, 0, 1_700_002_600, 10, '2023-11-15'); // 非法秒
      insertSession(db, 6, 1, 1_700_002_000, 1_700_002_600, 12.5, '2023-11-15'); // 非整数分钟
    });
    const adapter = new ReinaAdapter(file);
    try {
      // 三个读取入口口径一致：都失败，而不是返回“看起来完整”的 30 分钟。
      expectAdapterError(() => adapter.sessions(1), 'SCHEMA_UNSUPPORTED');
      expectAdapterError(() => adapter.snapshot(1), 'SCHEMA_UNSUPPORTED');
      expectAdapterError(() => adapter.stats(1), 'SCHEMA_UNSUPPORTED');
    } finally {
      adapter.close();
    }
  });

  it('from/to 是半开区间并按 start_time 过滤', () => {
    const file = createDb('range.db', (db) => {
      insertGame(db, 1);
      insertSession(db, 1, 1, 1_000, 1_060, 1, '1970-01-01');
      insertSession(db, 2, 1, 2_000, 2_060, 1, '1970-01-01');
      insertSession(db, 3, 1, 3_000, 3_060, 1, '1970-01-01');
    });
    const adapter = new ReinaAdapter(file);
    try {
      const sessions = adapter.sessions(1, iso(2_000), iso(3_000));
      expect(sessions.map((session) => session.id)).toEqual([2]);
    } finally {
      adapter.close();
    }
  });

  it('毫秒级边界通过 ceil 精确表达，整数秒不会被边界跨越', () => {
    const file = createDb('range-ms.db', (db) => {
      insertGame(db, 1);
      insertSession(db, 1, 1, 1_000, 1_060, 1, '1970-01-01');
      insertSession(db, 2, 1, 2_000, 2_060, 1, '1970-01-01');
      insertSession(db, 3, 1, 3_000, 3_060, 1, '1970-01-01');
    });
    const adapter = new ReinaAdapter(file);
    try {
      // from = 1000.5s → 排除 start=1000；to = 2989.5s → 保留 start=2000
      expect(
        adapter
          .sessions(1, new Date(1_000_500).toISOString(), new Date(2_989_500).toISOString())
          .map((session) => session.id),
      ).toEqual([2]);
    } finally {
      adapter.close();
    }
  });

  it('区间与其他作品隔离', () => {
    const file = createDb('isolation.db', (db) => {
      insertGame(db, 1);
      insertGame(db, 2);
      insertSession(db, 1, 1, 1_700_000_000, 1_700_000_600, 10, '2023-11-15');
      insertSession(db, 2, 2, 1_700_000_000, 1_700_000_600, 20, '2023-11-15');
    });
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.sessions(1).map((session) => session.id)).toEqual([1]);
      expect(adapter.sessions(2).map((session) => session.id)).toEqual([2]);
    } finally {
      adapter.close();
    }
  });

  it('参数非法时抛 INVALID_INPUT', () => {
    const adapter = new ReinaAdapter(createDb('invalid-args.db'));
    try {
      expectAdapterError(() => adapter.sessions(1, iso(2_000)), 'INVALID_INPUT');
      expectAdapterError(() => adapter.sessions(1, iso(3_000), iso(2_000)), 'INVALID_INPUT');
      expectAdapterError(
        () => adapter.sessions(1, '2026-10-20T00:00:00', '2026-10-21T00:00:00'),
        'INVALID_INPUT',
      );
      expectAdapterError(() => adapter.sessions(0), 'INVALID_INPUT');
      expectAdapterError(() => adapter.sessions(1.5), 'INVALID_INPUT');
      expectAdapterError(() => adapter.stats(-1), 'INVALID_INPUT');
    } finally {
      adapter.close();
    }
  });

  it('未知 gameId 返回空会话与 null 汇总，不伪造 0', () => {
    const adapter = new ReinaAdapter(createDb('unknown-game.db'));
    try {
      expect(adapter.sessions(999)).toEqual([]);
      expect(adapter.stats(999)).toEqual({
        sourceTotalMinutes: null,
        sourceSessionCount: null,
        sourceLastPlayed: null,
        sessionTotalMinutes: 0,
        sessionCount: 0,
        liveSession: false,
      });
    } finally {
      adapter.close();
    }
  });

  it(`会话数超过 ${MAX_SESSION_ROWS} 时失败而不是截断`, () => {
    const rows: SessionSeed[] = [];
    for (let index = 1; index <= MAX_SESSION_ROWS + 1; index += 1) {
      const start = 1_600_000_000 + index;
      rows.push([index, 1, start, start + 60, 1, '2020-09-13']);
    }
    const file = createDb('too-many-sessions.db', (db) => {
      insertGame(db, 1);
      insertManySessions(db, rows);
    });
    const adapter = new ReinaAdapter(file);
    try {
      expectAdapterError(() => adapter.sessions(1), 'DATA_LIMIT_EXCEEDED');
      expectAdapterError(() => adapter.snapshot(1), 'DATA_LIMIT_EXCEEDED');
    } finally {
      adapter.close();
    }
  });

  it('规范化数据超过 16MiB 时失败而不是悄悄返回', () => {
    const longDate = 'x'.repeat(500);
    const rows: SessionSeed[] = [];
    for (let index = 1; index <= 24_000; index += 1) {
      const start = 1_600_000_000 + index;
      rows.push([index, 1, start, start + 60, 1, longDate]);
    }
    const file = createDb('oversized.db', (db) => {
      insertGame(db, 1);
      insertManySessions(db, rows);
    });
    const adapter = new ReinaAdapter(file);
    try {
      const error = expectAdapterError(() => adapter.sessions(1), 'DATA_LIMIT_EXCEEDED');
      expect(error.message).toContain('16');
    } finally {
      adapter.close();
    }
  });
});

describe('ReinaAdapter 统计口径', () => {
  it('unsafe source totals remain missing rather than losing integer precision', () => {
    const file = createDb('unsafe-stats.db', db => {
      insertGame(db,1);
      insertStats(db,1,Number.MAX_SAFE_INTEGER + 1,Number.MAX_SAFE_INTEGER + 1,null);
    });
    const adapter = new ReinaAdapter(file);
    try { expect(adapter.stats(1)).toMatchObject({sourceTotalMinutes:null,sourceSessionCount:null}); }
    finally { adapter.close(); }
  });
  it('来源汇总与来源可空，缺失一律 null 且不被会话值替代', () => {
    const file = createDb('stats-null.db', (db) => {
      insertGame(db, 1);
      insertStats(db, 1, null, null, null);
      insertGame(db, 2);
      insertSession(db, 1, 2, 1_700_000_000, 1_700_001_800, 30, '2023-11-15');
    });
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.stats(1)).toEqual({
        sourceTotalMinutes: null,
        sourceSessionCount: null,
        sourceLastPlayed: null,
        sessionTotalMinutes: 0,
        sessionCount: 0,
        liveSession: false,
      });
      // 没有任何 game_statistics 行时同样为 null
      expect(adapter.stats(3)).toEqual({
        sourceTotalMinutes: null,
        sourceSessionCount: null,
        sourceLastPlayed: null,
        sessionTotalMinutes: 0,
        sessionCount: 0,
        liveSession: false,
      });
    } finally {
      adapter.close();
    }
  });

  it('来源汇总与会话派生累计分开返回，绝不合并', () => {
    const file = createDb('stats-split.db', (db) => {
      insertGame(db, 1);
      insertStats(db, 1, 999, 7, 1_700_000_000);
      insertSession(db, 1, 1, 1_700_000_000, 1_700_001_800, 30, '2023-11-15');
      insertSession(db, 2, 1, 1_700_002_000, 1_700_003_800, 30, '2023-11-15');
    });
    const adapter = new ReinaAdapter(file);
    try {
      expect(adapter.stats(1)).toEqual({
        sourceTotalMinutes: 999,
        sourceSessionCount: 7,
        sourceLastPlayed: iso(1_700_000_000),
        sessionTotalMinutes: 60,
        sessionCount: 2,
        liveSession: false,
      });
    } finally {
      adapter.close();
    }
  });

  it('来源 total_time 为 0 时保留 0（与缺失区分）', () => {
    const file = createDb('stats-zero.db', (db) => {
      insertGame(db, 1);
      insertStats(db, 1, 0, 0, null);
    });
    const adapter = new ReinaAdapter(file);
    try {
      const stats = adapter.stats(1);
      expect(stats.sourceTotalMinutes).toBe(0);
      expect(stats.sourceSessionCount).toBe(0);
      expect(stats.sourceLastPlayed).toBeNull();
    } finally {
      adapter.close();
    }
  });

  it('snapshot 的统计与会话来自同一批数据（区间过滤一致）', () => {
    const file = createDb('snapshot-consistency.db', (db) => {
      insertGame(db, 1);
      insertStats(db, 1, 200, 4, 1_700_003_000);
      insertSession(db, 1, 1, 1_000, 1_060, 10, '1970-01-01');
      insertSession(db, 2, 1, 2_000, 2_060, 20, '1970-01-01');
      insertSession(db, 3, 1, 3_000, 3_060, 30, '1970-01-01');
    });
    const adapter = new ReinaAdapter(file);
    try {
      const snapshot = adapter.snapshot(1, iso(2_000), iso(3_000));
      expect(snapshot.sessions.map((session) => session.id)).toEqual([2]);
      expect(snapshot.stats.sessionCount).toBe(1);
      expect(snapshot.stats.sessionTotalMinutes).toBe(20);
      // 来源汇总不受时间区间影响，保持来源原值
      expect(snapshot.stats.sourceTotalMinutes).toBe(200);
      expect(snapshot.stats.sourceSessionCount).toBe(4);
      expect(adapter.sessions(1)).toHaveLength(3);
    } finally {
      adapter.close();
    }
  });
});

describe('ReinaAdapter 只读约束', () => {
  it('读取操作不改动源文件字节，也不产生 -wal/-shm', () => {
    const file = createDb('readonly.db', (db) => {
      insertGame(db, 1, { name: '只读检查', tags: ['标签'] });
      insertSource(db, 1, 'bgm', '1', { name: '只读检查', tags: ['纯爱'] });
      insertSession(db, 1, 1, 1_700_000_000, 1_700_001_800, 30, '2023-11-15');
      insertStats(db, 1, 30, 1, 1_700_001_800);
    });
    const before = fs.readFileSync(file);
    const adapter = new ReinaAdapter(file);
    try {
      adapter.connection();
      adapter.games();
      adapter.sessions(1);
      adapter.stats(1);
      adapter.snapshot(1);
    } finally {
      adapter.close();
    }
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
    expect(fs.existsSync(`${file}-shm`)).toBe(false);
  });

  it('可以读取处于 WAL 且仍有写入连接的源库，且不破坏写入方', () => {
    const file = dbPath('wal.db');
    const writer = new Database(file);
    try {
      writer.pragma('journal_mode = WAL');
      writer.exec(SCHEMA_SQL);
      insertMigrations(writer);
      insertGame(writer, 1);
      insertSession(writer, 1, 1, 1_700_000_000, 1_700_001_800, 30, '2023-11-15');

      const adapter = new ReinaAdapter(file);
      try {
        expect(adapter.sessions(1)).toHaveLength(1);
        expect(adapter.stats(1).sourceTotalMinutes).toBeNull();
      } finally {
        adapter.close();
      }

      // 适配器关闭后写入方仍可用（说明我们没有 checkpoint 或持有排他锁）
      insertSession(writer, 2, 1, 1_700_002_000, 1_700_003_800, 30, '2023-11-15');
      expect(writer.prepare('SELECT COUNT(*) AS count FROM game_sessions').get()).toEqual({ count: 2 });
    } finally {
      writer.close();
    }
  });

  it('close 幂等，关闭后调用抛 NOT_CONNECTED', () => {
    const adapter = new ReinaAdapter(createDb('close.db'));
    adapter.close();
    adapter.close();
    expectAdapterError(() => adapter.connection(), 'NOT_CONNECTED');
    expectAdapterError(() => adapter.games(), 'NOT_CONNECTED');
    expectAdapterError(() => adapter.sessions(1), 'NOT_CONNECTED');
    expectAdapterError(() => adapter.stats(1), 'NOT_CONNECTED');
    expectAdapterError(() => adapter.snapshot(1), 'NOT_CONNECTED');
  });
});
