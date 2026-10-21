# NatsumeNote

NatsumeNote 是一款面向 Windows 的 Galgame 音乐播放器与作品手账。选择游戏目录后，它可以递归扫描普通音频和常见资源包，把音乐复制到独立音乐库，并自动抓取作品资料；每部作品还拥有独立的分页白板，可自由摆放便签、图片、视频、引用和曲目卡。

当前版本：`v_1.1`（内部版本 `1.1.0`） · Windows x64 · Electron

源码仓库：[github.com/wandererpg/NatsumeNote](https://github.com/wandererpg/NatsumeNote)

## 下载与安装

GitHub Release 建议上传下面两个压缩包和校验文件：

| 文件 | 用途 |
| --- | --- |
| `NatsumeNote-1.1.0-windows-x64-installer.zip` | 安装版。解压后运行 `NatsumeNote-1.1.0-installer/NatsumeNote-1.1.0-x64.exe`，可以选择安装目录，并创建桌面/开始菜单快捷方式。 |
| `NatsumeNote-1.1.0-windows-x64-portable.zip` | 便携版。解压后直接运行 `NatsumeNote-1.1.0-portable/NatsumeNote.exe`，不会执行安装流程。 |

## 功能

- 递归扫描游戏目录中的 `.ogg`、`.mp3`、`.wav`、`.flac`、`.m4a`、`.aac`、`.opus`、`.wma`、`.owp` 和 VisualArt's/RealLive 的 `.nwa`。
- 深度扫描 `.xp3`、`.rpa`、`.arc`、`.pak` 等 Galgame 资源包，并调用随发布包提供的 GARbro 工具解包。
- 识别 Studio Miris `SM2MPX10` 无扩展名容器：自动导入 `WMSC` 音乐，也可以按需导入 `VOICE*` 语音。
- 导入时复制文件到用户选择的音乐库，按文件哈希去重；原游戏目录不会被修改。
- 根据曲目时长将内容放入每个游戏的 `音乐` 或 `语音` 文件夹，语音阈值可以在设置中调整。
- 支持搜索、收藏、播放列表、曲目编号、顺序/随机/单曲循环/列表循环、进度和音量控制。
- 作品音乐标题栏和曲目行提供文件夹按钮，可在资源管理器中定位导入后的曲目，不会按文件关联打开媒体播放器。
- 每部作品拥有独立的“作品手账”：支持分页、可扩展画布、便签、引用、图片、视频和曲目卡。
- 手账卡片可以拖动、缩放、旋转、锁定、调整层级并撤销/重做；页面支持纸张、方格和点阵背景，可设置页面 BGM、进入记忆模式并导出 PNG/SVG。
- 首次导入游戏后，通过 VNDB 与 Bangumi 的公开 API 查询游戏资料，并尝试下载本地封面。网络失败不会阻止音乐入库。
- 导入完成页会显示 VNDB/Bangumi 的匹配状态：已匹配、无结果、候选不明确、查询失败或待查询；已有游戏可以手动刷新资料。
- 支持七套可即时切换的主题：雨夜青岚、霓虹终端、琥珀胶片、海月玻璃、唱片番台、绯幕金声、音乐手帐。
- 背景图片全局共用，可以导入 PNG/JPG/JPEG/WEBP/GIF，并调整模糊、遮罩、缩放和焦点位置；设置中还可以修改全局主要文字颜色或恢复主题默认颜色。
- 曲目表头采用无彩色液态玻璃样式，右侧音乐库使用统一的外层滚动区域。

## 快速开始

1. 启动 NatsumeNote，首次运行时选择音乐库目录。默认目录为 `%USERPROFILE%\Music\NatsumeNote`。
2. 点击“导入游戏数据”，选择游戏的根目录，并填写用于显示和网络匹配的游戏名。
3. 普通音频可以关闭深度扫描；音频位于 `.xp3`、`.rpa`、`.arc`、`.pak` 或无扩展名游戏资源中时，打开深度扫描。
4. 如果只想导入配乐，保持“包含语音”关闭。对于 `SM2MPX10` 游戏，`WMSC` 会被识别为音乐，`VOICE1`/`VOICE2` 等容器按选项决定是否导入；`.nwa` 音频会通过随包的 GARbro NWA bridge 转换成标准 WAV。
5. 等待导入结果。音乐复制完成后，软件会继续显示 VNDB、Bangumi 和本地封面处理结果。
6. 双击曲目播放。打开“设置”可以切换主题、修改背景、文字颜色、音乐库路径、播放模式和语音判定阈值。
7. 选中一部作品后切换到“作品手账”，可以新建页面、添加卡片和媒体、调整画布，再用“记忆模式”按页浏览。
8. 在“作品音乐”标题栏点击右上角文件夹按钮，或点击曲目行右侧的文件夹按钮，可跳转到该曲目所在的音乐库文件夹。

## 游戏资料与封面

网络资料是导入后的附加步骤，不是播放的前置条件：

- VNDB 和 Bangumi 查询需要网络，已缓存的资料和封面可以离线显示。
- 名称匹配不明确时不会擅自覆盖封面，游戏编辑器中可以查看候选状态并点击“刷新网络资料”。
- 手动选择的封面优先级最高，不会被后续自动匹配覆盖。
- 没有匹配结果、请求失败或封面下载失败时，曲目仍然保留在音乐库中；联网恢复后可以再次刷新。

## 作品手账

作品手账是按作品隔离的分页编辑空间。第一版提供的是卡片式白板，适合整理游玩记录、截图、演出片段和喜欢的曲目：

- 页面可以单独命名、排序、添加标签，并按需向右或向下扩展画布。
- 卡片类型包括便签、引用、图片、视频和曲目锚点；曲目卡可以记录开始播放的时间点。
- 图片和视频通过原生文件选择器导入后复制到游戏目录下的 `手账/素材`，按 SHA-256 去重；原始素材移动或删除不会影响已复制的手账素材。
- 选中卡片后可以拖动、缩放、旋转、锁定、置顶/置底、删除或复制；`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做、`Ctrl/Cmd+D` 复制卡片。
- 页面可以选择当前作品的任意曲目作为 BGM；播放按钮只在用户主动点击时开始，不会自动播放。
- “记忆模式”以阅读视图逐页浏览手账，并保留上一页/下一页和页面 BGM 控制；编辑器中的“导出 PNG/SVG”用于保存当前页面。
- 作品详情集中显示在“作品资料”中，不占用白板空间。导入音乐后会自动抓取并缓存 VNDB/Bangumi 资料；需要时仍可手动刷新。

第一版暂不包含自由笔刷、橡皮擦、多人协作或云端同步；这些能力可以在现有页面/卡片模型上继续扩展。

## 数据位置与备份

- SQLite 数据库位于 Electron 的 NatsumeNote 用户数据目录中的 `galmusic.db`；Windows 通常是 `%APPDATA%\NatsumeNote\galmusic.db`。
- 音乐文件和自动下载的封面位于用户选择的音乐库目录中。
- 手账页面和卡片数据位于 SQLite；导入的图片/视频位于每部作品目录下的 `手账/素材`，页面中的曲目卡只引用现有曲目 ID。
- 备份时请同时备份数据库文件和整个音乐库目录。只备份数据库会留下没有对应音频或手账素材的记录，单独备份音乐文件也会丢失收藏、播放列表、封面和手账页面。

产物目录结构如下（便携版还包含其他运行文件）：

```text
NatsumeNote-1.1.0-windows-x64-installer.zip
└─ NatsumeNote-1.1.0-installer/NatsumeNote-1.1.0-x64.exe

NatsumeNote-1.1.0-windows-x64-portable.zip
└─ NatsumeNote-1.1.0-portable/
   ├─ NatsumeNote.exe
   ├─ locales/
   ├─ *.dll 等运行文件
   └─ resources/

SHA256SUMS.txt
```


深度扫描依赖 `resources/tools/garbro/` 下的 GARbro 文件。发布包已经携带这套运行时资源；从源码自行打包前，请先确认资源校验通过，并确认 GARbro 及其依赖允许以你的发布方式再分发。

## Git 仓库

NatsumeNote 使用独立远程仓库 `git@github.com:wandererpg/NatsumeNote.git`，不会推送到原 `wandererpg/NatsumeMusic` 仓库。提交前请确认 `git remote -v` 指向该地址，并继续遵守下面的发布材料与许可证检查。

更详细的真实运行逻辑、代码地图和验证记录见：

- [`docs/GalMusic-实际运行逻辑.md`](docs/GalMusic-实际运行逻辑.md)
- [`docs/verification.md`](docs/verification.md)
- [`docs/superpowers/plans/2026-08-24-game-metadata-auto-import.md`](docs/superpowers/plans/2026-08-24-game-metadata-auto-import.md)
- [`docs/superpowers/plans/2026-09-12-work-scrapbook-canvas.md`](docs/superpowers/plans/2026-09-12-work-scrapbook-canvas.md)

## 许可证与第三方组件

发布包包含 GARbro、Electron/Chromium 以及多个 npm/.NET 依赖。许可证材料和当前逐项复核状态见 [`THIRD-PARTY-NOTICES.draft.md`](THIRD-PARTY-NOTICES.draft.md)、[`licenses/README.md`](licenses/README.md) 和 [`licenses/garbro/COMPONENT-INVENTORY.md`](licenses/garbro/COMPONENT-INVENTORY.md)。当前仍缺少项目本体的根目录正式 `LICENSE`，且 GARbro 当前构建的来源尚未完全证明；现有草稿仍按原 NatsumeMusic 仓库编写，发布 NatsumeNote 前还必须更新项目名称、仓库地址和本体许可证信息，并完成所有门禁。

## GitHub 发布建议

1. 将源码、`README.md`、必要的许可证和第三方声明放在仓库根目录。
2. 不要把 `node_modules`、`out`、旧的 `release-v*` 构建目录或用户音乐库提交到源码仓库。
3. 创建 GitHub Release，建议使用标签 `v_1.1`。
4. 在 Release Assets 中上传 `NatsumeNote-1.1.0-windows-x64-installer.zip`、`NatsumeNote-1.1.0-windows-x64-portable.zip` 和 `SHA256SUMS.txt`。
5. 发布前确认 GARbro 和其他随包第三方组件的许可证、版权声明及再分发条件；如需要，请把对应的 `LICENSE`/`NOTICE` 文件一并放入仓库和发布说明。
