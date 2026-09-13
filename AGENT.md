# NatsumeNote 开发代理说明

## 项目定位

NatsumeNote 是从 NatsumeMusic 演进而来的 Windows 桌面应用。它不只是音乐播放器，还包含按作品隔离的分页手账/白板。后续允许大幅调整交互逻辑，但必须保护用户的音乐库、手账素材和 SQLite 数据。

## 技术栈与目录

- Electron 31、React 18、TypeScript、electron-vite。
- `src/main/`：Electron 主进程、SQLite 数据访问、文件系统与网络服务、IPC 处理。
- `src/preload/`：唯一可信的渲染进程桥接层；通过 `contextBridge` 暴露最小 API。
- `src/renderer/src/`：React 界面、Zustand 状态、播放器与作品手账。
- `src/shared/`：主进程、预加载和渲染进程共享的类型、IPC 通道和 URL/路径工具。
- `tests/`：Vitest 测试，按 `main`、`preload`、`renderer`、`scripts`、`shared` 分类。
- `resources/tools/garbro/`：深度扫描需要的 GARbro 运行时；不要随意删除、替换或重命名。
- `docs/`：实际运行逻辑、验证记录以及功能设计/实施文档。

## 架构边界

- 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。渲染进程不得直接访问 Node.js、SQLite 或任意本地路径。
- 新的跨进程能力应按顺序同步更新 `src/shared/ipc.ts`、共享类型、主进程 handler/service、`src/preload/index.ts` 和对应测试。
- 所有来自渲染进程的 IPC 参数都视为不可信输入；在主进程验证类型、长度、枚举值和路径边界。
- 用户文件操作必须限制在已授权的音乐库/素材目录内，并使用 `assertWithin`、路径规范化及文件类型白名单等现有保护。
- 数据库结构只通过 `src/main/database/migrations.ts` 向前迁移；迁移必须可重复执行并兼容已有用户数据库，禁止用破坏性重建代替迁移。
- 音频、封面、背景和手账媒体继续通过已注册的自定义协议提供给渲染进程，不暴露原始 `file://` 路径。
- 导入游戏目录时不得修改原游戏文件。复制、重命名、删除音乐库内容时要保持数据库与文件系统一致，并覆盖失败回滚场景。
- 网络元数据是可选增强：VNDB/Bangumi 请求失败不得阻塞本地导入、播放或手账使用。

## 交互逻辑修改原则

- 可以重构或替换现有交互，但先明确状态归属、持久化时机、撤销/重做边界、键盘与指针操作的冲突处理。
- 手账数据按游戏隔离；页面、卡片、素材和曲目引用不能跨游戏串联。
- 拖动、缩放、旋转等高频交互避免每次 pointer move 写入 SQLite；完成交互后再持久化，并确保未保存状态可见。
- 维持基本可访问性：交互控件使用原生按钮/输入框，提供可读名称、焦点状态和键盘替代操作。
- 改动 UI 时同时检查窄窗口（最小 960×640）、长文本、空状态、加载中、失败状态和大量曲目/卡片场景。

## 开发与验证

环境要求为 Windows x64、Node.js 20 或 22 LTS。

```powershell
npm install
npm run dev
```

提交前至少运行与改动直接相关的测试。完整验证命令为：

```powershell
npm test -- --run
npx tsc --noEmit
npm run verify:resources
npm run build
```

涉及 Windows 安装包时再运行 `npm run package:win`。原生模块 ABI 异常时先运行 `npm run rebuild:native`；只有明确需要源码编译时才使用 `npm run rebuild:native:source`。

## 测试与提交要求

1. 每次功能或行为改动都必须新增或更新相应测试；纯文档/注释改动无需制造无意义测试。
2. 修复缺陷时优先添加能够复现问题的回归测试，再实施修复。
3. 交付前运行与改动范围相称的测试、类型检查和构建，并如实记录未运行或失败的检查。
4. 每组完整、可回滚的改动都创建对应 Git commit；不要把无关改动混入同一提交。
5. 不提交 `node_modules/`、`out/`、发布产物、数据库、用户音乐库、日志、`.env` 或凭据。
6. 不删除或覆盖其他人尚未提交的工作；发现工作树已有改动时先理解并保留其意图。

## Git 与发布

- 本仓库的独立远端为 `git@github.com:wandererpg/NatsumeNote.git`，不得推送到原 NatsumeMusic 仓库。
- 默认分支为 `main`。除非用户明确要求，不重写历史、不强制推送、不自动创建 Release。
- 正式发布前复核 `THIRD-PARTY-NOTICES.draft.md`、`licenses/`、GARbro 再分发条件以及根目录项目许可证。
- 推送前使用 `git status` 和 `git diff --check` 检查提交范围与空白错误，并确认没有敏感信息或意外的大文件。
