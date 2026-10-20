# DeepSeek 协作提示词：ReinaManager 游玩记录 MCP 与标签交互评审

你是由 Codex 负责规划和验收的 DeepSeek 模块协作者。请使用中文完成任务。

## 目标与当前阶段

用户希望 NatsumeNote 能通过 MCP 获取 ReinaManager 记录的 Galgame 游玩时段、累计时长、最近游玩情况，并借鉴其标签交互。本轮先做有源码依据的设计，不实现应用功能、不安装依赖、不启动用户应用、不访问真实用户数据库、不打包、不推送。

## 工作区和文件所有权

- 唯一工作目录：`D:\Codex\NatsumeNote`。全部命令的工作目录必须在此目录内；所有文件写入必须在此目录内。
- 只允许创建/修改 `docs/reina-mcp-deepseek-review.md`，不得修改其他文件；Codex 负责方案、提示词、证据和最终提交。
- 必须先阅读 `AGENT.md`、`docs/reina-mcp-source-evidence.md`、`docs/superpowers/plans/2026-10-21-reina-mcp-integration.md`。
- 可以按需读取本工作区 `src/shared/types.ts`、`src/shared/ipc.ts`、`src/main/database/migrations.ts`、`src/main/database/connection.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/components/library/GameOverview.tsx`、`src/renderer/src/features/journal/JournalWorkspace.tsx`、`src/renderer/src/components/settings/SettingsPanel.tsx`。
- ReinaManager 源码依据已摘录在证据文档中，不要到工作区外执行命令或写入。不要改动 NatsumeMusic、ReinaManager 或既有音乐/手账/资料数据。
- 你没有用户对话上下文，请以本文要求为完整任务，不读取凭据、环境文件或用户数据库。

## Codex 已确定的设计边界

1. 所有桥接代码放 NatsumeNote；ReinaManager 现有 Tauri command 不是 MCP 服务。不声称它已有原生 MCP 或可以读取实时未结束会话。
2. 首版采用用户选定数据库的只读兼容适配器。主进程内用官方 MCP SDK 的 client/server 和 InMemoryTransport 连接，不开放网络端口。MCP 是协议层，数据库适配器是数据来源层，必须区分。
3. 将来可复用同一 MCP server 增加外部 stdio 入口；本轮不承诺外部客户端已经能连接，也不预设安装版 Electron 的 stdio/原生模块运行一定可用。
4. ReinaManager 的 start_time/end_time 为 Unix 秒，duration/total_time 为分钟；duration 可能是前台有效时间，不能用起止差替代，也不能从历史行猜测计时模式或手工记录类型。
5. 作品按来源库实例 ID 和外部 game_id 标识；VNDB/Bangumi ID 只生成关联候选，用户确认绑定后才保存。名称相同不能直接合并。
6. 首版只读取已结束且已持久化会话，显示来源、时间精度、抓取时间。不能将音乐播放时长算成 Galgame 游玩时长。
7. 原始来源汇总和会话累计分开，说明统计口径。跨日有效时长只能按时间跨度分摊估算，不能伪造精确每日有效时长。
8. 安全采用只读连接、短只读事务、固定 SQL、参数验证、分页和显式路径授权。不得对外部数据库跑 NatsumeNote migrate、journal_mode 写设置、checkpoint、写回或仅复制主 db 忽略 WAL。
9. 标签借鉴交互思想，沿用 React/lucide 和现有主题；不引入 MUI，不复制 AGPL 翻译字典/组件实现。

## 你需要交付的评审

在唯一拥有的报告文件中写清：

- 已核实事实与证据路径/行号，区分源码事实、建议、仍需实测事项。
- 按严重程度列出接口方案的遗漏或风险，并给可执行修正建议：字段单位、跨日时区、分页一致性、源库切换、记录修改/删除、陈旧缓存、未知 schema、只读并发、进程响应时间、来源归属、MCP 角色与生命周期。
- 核查至少 3 个 MCP 查询工具及结构化返回，给 2 个调用示例；不把 NatsumeNote 本地绑定操作暴露为外部修改工具。
- 标签交互建议：展开/折叠、选择筛选、清空、中文名/原名、来源标记、溢出、空态、键盘及加载失败；明确与手账页自己的 tags 分开。
- 建议的最小实现文件范围和验收场景。不要写“已实现”“测试通过”等没有执行证据的结论。
- 只修改报告文件，完成后告知文件路径、主要发现、你实际执行的检查。不提交、不推送；不要等待用户批准或另起 worker。

## 验收

报告引用的文件和字段都存在；分钟与秒不混用；源记录与本地手账数据边界明确；不声称实时计时/统计推算精度；遵守单文件所有权。请实际自检报告后交还 Codex 评审。
