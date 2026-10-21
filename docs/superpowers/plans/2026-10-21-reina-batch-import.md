# ReinaManager 批量作品导入

**目标：** 从已授权来源预览全部作品，唯一匹配已有作品，允许逐项手动关联、新建或跳过，并创建缺失的作品目录。

**实现边界：** 独立 `reina/batch-import.ts` 负责分页读取、匹配、预览令牌和原子落库；独立 IPC handler 验证参数并排他执行。共享类型和 preload 增加预览/确认接口；数据连接面板内嵌批量编辑器。不修改来源数据库，不自动执行真实用户导入。

- [x] 添加回归测试并确认缺失功能导致失败：分页、重复导入、歧义、手动匹配、过期预览、目录碰撞和失败回滚。
- [x] 实现预览及确认：只用唯一资料编号/规范化完整标题匹配；已有链接优先；重名留待确认；新建名称避免目录碰撞；只清理本次创建的空目录。
- [x] 接入严格校验的 IPC 与 preload；确认时重新读取来源及校验本地库未变化。
- [x] 添加有加载、失败、结果提示的逐项编辑 UI，完成后刷新本地作品及标签。
- [x] 更新使用说明，运行针对性测试、类型检查、资源检查、构建和窄窗口 UI 检查，精确提交本次文件。

**验证：** `npm test -- --run tests/main/reina-batch-import.test.ts tests/main/reina-handlers.test.ts tests/main/reina-service.test.ts tests/renderer/reina-ui.test.tsx tests/preload/preload.test.ts`；`npx tsc --noEmit`；`npm run verify:resources`；`npm run build`。保留现有四个界面文件的未提交修改。

**验证结果：** 针对性回归测试、TypeScript 类型检查、资源检查、生产构建全部通过；原生 MCP 合成数据检查通过；8 种 960×640 界面状态无横向溢出。独立代码审查发现的来源重新确认、跨资料库编号冲突两项问题已修复并有回归覆盖。未执行真实用户批量导入，未修改来源数据库，未打包或推送。
