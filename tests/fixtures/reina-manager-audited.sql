-- Synthetic, self-contained ReinaManager layout. Contains no user data.
CREATE TABLE games(id INTEGER PRIMARY KEY, id_type TEXT NOT NULL DEFAULT 'mixed', custom_data TEXT);
CREATE TABLE game_sources(game_id INTEGER NOT NULL, source TEXT NOT NULL, external_id TEXT, data TEXT, PRIMARY KEY(game_id,source));
CREATE TABLE game_sessions(session_id INTEGER PRIMARY KEY,game_id INTEGER NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,duration INTEGER NOT NULL,date TEXT NOT NULL);
CREATE TABLE game_statistics(game_id INTEGER PRIMARY KEY,total_time INTEGER,session_count INTEGER,last_played INTEGER,daily_stats TEXT);
CREATE TABLE seaql_migrations(version TEXT PRIMARY KEY,applied_at INTEGER NOT NULL);
INSERT INTO seaql_migrations VALUES
('m20250927_000001_baseline_migration',1),
('m20250928_000002_split_games_table',2),
('m20250930_000003_add_collections',3),
('m20251229_000004_hybrid_single_table',4),
('m20260104_000005_add_le_magpie_fields',5),
('m20260131_000006_migrate_clear_to_play_status',6),
('m20260201_000007_clean_empty_strings',7),
('m20260318_000008_add_vndb_token_and_collection_sync',8),
('m20260331_000009_add_kungal_support',9),
('m20260505_000010_remove_redundant_created_at',10),
('m20260508_000011_bgm_oauth',11),
('m20260525_000012_move_custom_date_to_games',12),
('m20260706_000013_reconcile_indexes',13),
('m20260706_000014_migrate_game_sources',14),
('m20260712_000015_split_game_local_path',15),
('m20260722_000016_backfill_game_defaults',16),
('m20260801_000017_add_tasks',17),
('m20260805_000018_hikarinagi_oauth',18),
('m20260809_000019_add_steam_launch',19),
('m20260922_000020_savedata_backup_root_semantics',20),
('m20260923_000021_tool_integration_defaults',21);
