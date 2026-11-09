# Contributing / 协作规则

本仓库的每一次改动都必须留下可追溯的记录，**不接受直接推 `main`**。

## 流程

1. **开议题**：描述背景、交付物、验收标准、依赖。平台相关改动用 `platform-verify` 模板。
2. **开分支**：`<type>/<issue#>-<slug>`，例如 `feat/5-zip-engine`、`ci/2-matrix`。
3. **提 PR**：标题用 Conventional Commits，正文写 `Closes #N`（或 `Refs #N`），并填写 PR 模板。
4. **本地自查（PR 阶段不跑 CI）**：`node --test "test/**/*.test.mjs"` 全绿、`npm pack --dry-run` 通过；改动涉及平台行为或真机语义时，在 PR 正文里写清构建阶段要验证什么。
5. **合并**：squash merge 到 `main`，合并后删除分支。分支保护保留线性历史、禁止强推与直接推送，但**不再要求 PR 阶段的状态检查**。
6. **构建/发布阶段跑 CI**：合并到 `main` 自动触发三平台冒烟（`ci.yml`）；需要全矩阵/兼容性通道时在 Actions 里手动 `workflow_dispatch`；发布 tag 触发 `release.yml`。CI 红灯用后续 PR 修，不阻塞合并。

> 为什么不在 PR 跑 CI：三平台矩阵 + `compat-next` 每个 PR 要占用数分钟，与「构建阶段集中验证」的规约冲突。PR 阶段靠本地自查与同侪审查，风险由构建阶段的矩阵兜底。

## 分支与产物清理

- 合并后用 `gh pr merge --delete-branch` 或 `git push origin --delete <branch>` 删除远端分支，并 `git branch -d <branch>` 清理本地分支。
- 本机构建产物（`dist/`、`*.tgz`、测试用 `*.zip`）与临时 `DSH_HOME` 目录用完即删，不留在仓库与 home 里。
- 长期不用的 worktree 用 `git worktree remove` 清理。

## 提交信息

`feat:` `fix:` `ci:` `docs:` `test:` `refactor:` `chore:` + 中文或英文描述，末尾括号引用议题号（`(#5)`）。

## 代码约定

- ESM（`type: module`），相对导入必须带扩展名。
- `lib/index.js` 是**唯一**允许 `import '@deepseek-ai/*'` 的文件；那些包必须同时出现在 `peerDependencies`（运行时）里，**绝不放进 `dependencies`**（会静默不加载）。
- 所有可测试逻辑放 `lib/core/*.mjs`：零依赖、纯函数、可注入 fs/时钟。
- 测试放 `test/`，用 `node --test "test/**/*.test.mjs"`，不引入测试框架。
- 任何触碰文件系统的自动化都必须只用 `DSH_HOME` 指向的临时目录；真实 `~/.dsh` 只读。

## 平台

Linux / Windows / macOS 都要能跑。写路径用 `node:path`，不要硬编码 `/`；不要依赖执行位（Windows 没有），改为按 `manifest` 里的 mode 记录、能设则设。
