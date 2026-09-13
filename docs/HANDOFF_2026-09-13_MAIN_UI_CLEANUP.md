# Main 与微信 UI 清理交接（2026-09-13）

## 本阶段目标与结果

- 上午 `codex/production-integration` 的最终内容已整理到 `main`。
- `main` 先重放到 `origin/main` 的真实基线上，避免原先 `ahead 9, behind 1` 的分叉历史。
- 清理开始前的 `main` 与 `codex/production-integration` 文件树完全一致。
- 工作期间 `origin/main` 已更新到重放后的上午最终提交 `c681c63`；本阶段 UI 清理在该提交之上完成。
- 微信小程序现在只有一个正式构建入口：仓库根目录 `project.config.json` 指向 `dist/`。

## 已删除的旧 UI

- 删除独立网页/微信样稿应用 `apps/ui-preview/`。
- 删除 `FLIGHTOR_UI_EXPERIENCE` 构建分支、`config/ui-experience.js` 和独立项目配置。
- 删除 `build/check/open:ui-experience` 命令及其旧构建、检查脚本。
- 删除只供独立样稿使用的 `AppExperience`、固定旅行/航班/探索样例和旧样稿页面。
- 删除正式规划页内完整的旧 `AgentChat` 界面以及“经典规划”回退入口。
- 删除本地 `.worktrees/ui-experience` 工作树。`codex/ui-experience` 分支及远端提交仍保留，可用于历史追溯。
- 删除 AppleDouble `._*` 元数据文件，并在 `.gitignore` 中永久忽略；`.worktrees/` 也不再污染主工作区状态。

`src/features/ui-experience/` 目录名仍保留，因为正式探索、航班、行程、个人和规划页面正在复用其中的新版生产视觉组件与数据展示类型。该目录不再拥有独立小程序入口。

## 正式入口

- 微信开发者工具应导入：`D:\FunnyProject\flightor-repo`
- `miniprogramRoot`：`dist/`
- 正式构建：`npm run build:weapp`
- 本地后端联调构建：`npm run build:weapp:local`
- 不要导入旧分支工作树或历史 `dist/ui-experience` 路径；该产物目录已不存在。

## 最终验证

- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `npm run test:session-recovery`：19 项通过；包含“只挂载生产 Planner、无经典回退、登录后恢复原请求”。
- `npm run test:production-presentation`：30 项通过（展示 17、回复 6、行程库 7）。
- `npm run build:weapp`：Taro/Webpack 编译成功。
- 编译产物包含新版四栏自定义导航：规划、探索、行程、我的。
- `dist/ui-experience` 不存在；旧 `agent-chat`、旧构建开关和独立样稿入口不再进入正式产物。

## 已知非阻塞项

- 构建仍提示 `castle.jpg`（356 KiB）和 `hero.jpg`（261 KiB）超过 Webpack 推荐体积。
- 构建仍给出未使用异步分包的性能建议。
- 本阶段没有打开微信开发者工具做模拟器或真机视觉验收；最终 `dist/` 已生成，需在开发者工具中清缓存后重新编译查看。
- 根目录缺少 Taro 全局配置文件会显示提示，但不影响本次构建成功。

## 下一阶段建议

1. 在微信开发者工具删除旧项目记录，仅重新导入仓库根目录。
2. 执行“清除缓存 -> 全部清除”，再点击编译，确认四个主页面和规划流程均为新版视觉。
3. 如需优化包体，再压缩两张超限图片并评估分包；不要重新引入独立 UI 产物路径。
