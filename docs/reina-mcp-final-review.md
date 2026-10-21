# ReinaManager MCP 最终只读评审（范围受限）

范围：`src/main/reina/service.ts`（授权/await 后守卫）、`engine.ts`（快照子集/未知作品）、`errors.ts`（错误码净化）、`tag-index.ts`（provider 键 SQL）。除用户要求的 3 处 grep/read 辅助确认（`migrations.ts` 外键、`shared/reina.ts` 键、UI 标签文案）外未读其它文件；本轮无 shell，未运行测试（Codex 已跑 518 项）。

## 结论：无阻断项（0 data-loss / 0 security / 0 wrong-stat 可达缺陷）

## 具体发现（1 条，低）

- **F1 `errors.ts:27` 未覆盖 `service.ts:107` 的文案**：`findGame` 抛 `'来源作品已不存在，请重新搜索并选择。'`，而 `errors.ts:27` 的候选是 `来源作品不存在`（无「已」），`/^…|来源作品不存在/` 不命中 → 落到 `errors.ts:30` 的 `SOURCE_UNAVAILABLE`（`retryable: true`，文案为「无法读取数据库…若来源正在保存，请稍后重试」），把「作品已从来源消失」误报成「数据库读不了、可重试」。可复现路径：预览有效（`service.ts:112-113`）但来源已删掉该作品时 `bind` 失败。修法：候选改为 `来源作品(已)?不存在`，或直接抛 `reinaError('INVALID_INPUT')`。仅影响提示与重试语义，不影响数据。

## 已核实正确（逐条给了依据）

- **await 后守卫齐全**：`service.ts:25-36` 先 `verifyIdentity`（:27，比对 realpath+identity），调用时传当前 `file_identity`（:30），await 回来后 `ensureOpen()` + 重读来源行比对 `file_identity`（:31-34）。`connectSelectedFile` 替换路径同样在 await 后 `ensureOpen(); verifyIdentity(replacement)`（:70）才在同一事务里更新身份、把旧关联标 `needs_confirmation=1`、清来源标签（:71-75），失败不落任何写操作。
- **`bind` 的 await 后身份不弱**：`service.ts:116` 只比对数据库行，但每次 `findGame` 分页调用都经过 `:25-36` 的 handler，其 await 后守卫在文件被替换时已抛 `SOURCE_CHANGED`；`findGame` 返回与写库之间无 await，无交错窗口，故不构成缺口。
- **快照子集安全**：`engine.ts:39-48` 同时校验 cursor 归属工具（:42）、`snapshotId` 与 cursor 一致（:42）、`sourceId` 与 `path`（:46）、`scope` 全等（:47）；`reina_get_stats` 复用会话快照额外要求同一 `gameId` 且 `covers()` 收窄成立（:47、:91-93），不会把宽范围快照当窄范围结果。快照淘汰后旧 cursor 明确报「分页已失效」（:42/:46），不静默返错页。
- **未知作品**：`engine.ts:65` 先判 `gameId` 存在，否则 `INVALID_INPUT`（比空数组更诚实）；`:51` stats 的 `snap.stats!` 只在 `:47` 的 stats 分支可达。
- **统计口径**：`engine.ts:51-52` 区间查询只重算 `session*`，`source*` 保持来源全量；UI 明确标为「来源累计」（`PlaySessionPicker.tsx:307`、`ReinaGamePanel.tsx:940`），因此不构成 wrong-stat；`:52` 仅在无区间时输出「不一致」警告是自洽的。
- **错误净化**：`errors.ts:3-15` 码白名单 + 固定文案，`:19` 用 `Object.hasOwn` 防原型链误命中，原始 SQLite 文案只在 `:22-29` 内部做匹配、绝不外泄；未知一律归 `SOURCE_UNAVAILABLE`。
- **标签键 SQL**：`tag-index.ts:34` 的 `provider || ':' || name` 与 `shared/reina.ts:4` 的 `reinaTagKey` 完全一致（值全部参数化，无拼接注入）；写入口 `:14`/`:23` 与表主键 `migrations.ts:223`（`local_game_id, origin_key, provider, name`）配合 `INSERT OR IGNORE`，重复刷新不产生重复行；`migrations.ts:212-223` 三条外键均 `ON DELETE CASCADE`，且 `migrations.ts:73` 在提前返回（:82）之前开启 `foreign_keys`，因此断连/删本地作品不会留下孤儿标签或孤儿关联。

## 关于无效会话行（刻意设计）

Codex 复核处置：F1 已修复，错误匹配兼容「来源作品不存在」与「来源作品已不存在」，均返回 `INVALID_INPUT`、`retryable: false`。新增官方 MCP 传输回归测试，先确认失败再修复，通过后纳入完整验证。本报告其余结论不变。

最终实现选择**整次查询失败**而非跳过：`adapter.ts:847-856` 遇到无法解释的会话行直接抛 `SCHEMA_UNSUPPORTED`（消息带 `session_id`），不回退、不部分返回；`errors.ts:7` 的文案已说明「结构不兼容或存在无效会话」。后果是：某作品只要有一条历史坏行，该作品的会话与含区间的统计都读不出来（fail-closed，不会伪装成完整累计）。这是有意的，非缺陷；若产品日后要降级，应走显式 warnings 通道而非静默跳过。
