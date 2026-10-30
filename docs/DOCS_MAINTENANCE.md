# 文档同步规则

更新：2026-10-19，沿用“每次修改同时更新 docs”的仓库要求。

- 变更前阅读文档入口和当前上下文。
- 仓库根目录 `AGENTS.md` 要求在整个开发过程中持续维护 `docs/` 重要文档；行为、合同或验证结果变化时，在完成前同步更新所属文档，不把文档延后为独立清理。
- 启动/环境修改更新 [deploy](deploy.md)，共享数据/后端边界修改更新 [BACKEND_MVP](BACKEND_MVP.md)，能力变化更新 [PROJECT_CONTEXT](PROJECT_CONTEXT.md)。不能只追加通用进度。
- 区分已实现、待实现、已验证、未验证。旧分支证据不代替本分支实测。
- 保留其他分支和工作区改动，不自动合并或发布。
- `scripts/check-docs.cjs` 只检查 docs 相对链接与修改批次文档同步，不证明语义、外链或运行正确。

```powershell
npm run check:docs
git diff --check
node scripts/check-docs.cjs --staged
git diff --cached --check
```

提取时移出的旧后端文档与验收脚本仍保存在原分支/历史。新后端应维护其实际接口、配置、迁移与验收说明。
