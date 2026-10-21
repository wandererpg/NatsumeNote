# ReinaManager 第 22 次迁移兼容修复

日期：2026-10-21。所有改动位于 NatsumeNote，未修改 ReinaManager。

## 根因与源码核对

用户选中的实际数据库包含 `m20261006_000022_nextmoe_oauth`，旧适配器白名单仅到第 21 次迁移，因此在连接阶段报 `SCHEMA_UNSUPPORTED`，尚未读取游玩会话。此次报错不代表游玩记录损坏。

增量核对官方提交 `4d2c9440bdbd088a73e1c4abf95a7b9ae35dc31c`：

- [第 22 次迁移](https://github.com/huoshen80/ReinaManager/blob/4d2c9440bdbd088a73e1c4abf95a7b9ae35dc31c/src-tauri/migration/src/m20261006_000022_nextmoe_oauth.rs) 新增 `user.nextmoe_auth`，清理没有快照的旧 Kun 来源并解绑其旧编号，保留已有资料快照。不改变桥接读取的会话、统计列及秒/分钟语义。
- `migration/src/lib.rs` 注册了该迁移。
- `entity/game_sessions.rs`、`entity/game_statistics.rs`、`game/monitor/session.rs` 与原审计提交内容一致（比较时规范化换行）。
- 迁移文件 SHA-256：`59cf1000e254c5ed1001a0507d5dae3a4b8bba5867cce2243dbc06753d9a8d1a`。

只扩充这一条已核实的迁移白名单；所需表/列、类型、主键和未知迁移检查保持有效。NatsumeNote 不执行该迁移，不读取账号授权字段，不向来源写入数据，也未复制官方实现代码。

## 验证

- 用合成第 22 次迁移布局先复现相同失败，再验证连接、作品读取、记录分钟数与来源累计独立、源文件字节不变。既有第 21 次及更早布局和未知迁移拒绝测试继续通过。
- 56 项相关测试通过，类型检查与构建通过。
- 原生 Electron → 官方 MCP → 独立查询进程的 smoke 改用合成第 22 次迁移库，验证完整连接链路、分页与只读保证。
- 经用户明确提供路径后，对实际库只读检查了结构、迁移版本及连接结果；修复后 `readable: true`，检查前后文件 SHA-256 相同。未打印作品名称、游玩会话或账号内容，未写入或备份实际库。

当前实际库验证覆盖连接阶段；用户仍需在界面确认作品关联后查看自己的会话。使用开发版时须退出并重新启动 NatsumeNote，使主进程加载修复；现有 EXE 未重新打包。
