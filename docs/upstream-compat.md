# 上游兼容性记录（官方仓库调查）

本文件记录 `dsh-migrate` 与上游官方仓库 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 的版本兼容性。
调查方式：**只用 GitHub API 读官方仓库**（按 tag 取 blob 逐文件比对），不 clone、不安装/不运行目标版本。
真机验证过的版本会单独标注；未真机验证的结论一律标「静态调查」。

## 版本总览

| DSH 版本 | 真机验证 | cordis | schemastery | `engines.node` | 结论 |
|---|---|---|---|---|---|
| `0.2.0-rc.2` | ✅ 本机 | 4.0.4 | 3.18.4 | 未声明（包内 action 实际可用 22.19+） | 可用 |
| `0.2.1-rc.2` | ✅ 本机 | 4.0.5 | 3.18.5 | 同上 | 可用；`ci / compat-next` 长期跑 |
| `0.2.1-rc.3 … rc.5` | — | 4.0.5 | 3.18.5 | 同上 | 静态调查：与 rc.2 同一插件契约 |
| `0.2.2-rc.1`（当前 `latest`） | ✅ **CI 自动化**（2026-11-08） | **4.1.0** | **3.19.0** | **`>=24.9.0`** | 静态调查 + `ci / compat-next` 实跑通过：`dsh next = 0.2.2-rc.1`、集成测试 1/1、组合层与 `/api/dsh-migrate/state`（version 与 package.json 一致）均 OK；但**人工/浏览器**未验证 |

> `0.2.2-rc.1` 发布于 2026-11-04。npm dist-tags 当时为 `latest = 0.2.2-rc.1`、`next = 0.2.2-rc.1`、`alpha = 0.2.2-alpha.3`。

## 对插件的影响面（0.2.1-rc.2 → 0.2.2-rc.1 静态调查）

| 影响面 | 结论 | 要改代码？ |
|---|---|---|
| 包清单 `dsh.bundle` / `dsh.client` / `icon` / `exports` | 兼容；仅新增可选字段（见下） | 否 |
| 兼容性门禁 `packages/boot/app-boot/src/plugin-compatibility.ts` | **逐字未变**；判定用 `semver.satisfies(runtime, range, { includePrerelease: true })`，现有 peer 范围在 0.2.2-rc.1 仍通过 | 否（建议补 0.2.2 线消除 pnpm 警告，见 #60） |
| `defineTool` / `ctx.tools.register` / `ctx.skills.register` | 契约不变 | 否 |
| `ctx.inject(['webServer'])` + `webServer.register({ kind:'exact', path, handler })` | handler 未废弃；新增可选 `resource: (Request, peer?) => Promise<Response>` | 否 |
| 客户端 slot `settings.plugins.tab` | 仍在；options 仍为 `id` / `order` / `label` | 否 |
| 新增 slot `settings.section.icon` | 只对 `settings.section` 的导航字形生效，与插件 tab 无关 | 否 |
| `window.__ModuleLoader__.load` / `require('react')` | 协议不变；baseline externals 未变 | 否 |
| 客户端图片资源 | 新增 `require.asset()` 与 `/plugins/<pkg>/assets/<path>`、`exports["./assets/*"]` 约定；我们没用图片 | 否 |
| profile 模板 / 官方 bundle 目录 | `PROFILE_TEMPLATES` 等迁到新包 `@deepseek-ai/dsh-official-bundles`；`RETIRED_BUNDLES` 含 `@deepseek-ai/dsh-experimental-schedule-bundle` | 否（文档提醒见 #58） |
| plugin-manager 安装来源 / 审批 | 本地目录 / tgz / git 解析未变；新增 git 源 `allowBuilds` 审批、bundle 平台校验 | 否 |
| 升级指南（0.2.1-rc.3 8 条、rc.4 2 条、0.2.2-alpha.2 13 条） | 无一针对包清单 / 插槽 / 客户端加载器 | 否 |
| 开发者文档 `docs/user/develop/**` | basic / tool / config / publish / service / practice 逐字未改 | 否 |

### 新增的可选清单字段（`packages/util/package-manifest/src/types.ts`）

- `dsh.bundle.platforms?: string[]`：支持的 Host 操作系统（Node 平台名）；缺省 = 全平台。声明不含当前平台时，安装/激活会抛 `UnsupportedBundlePlatformError`（`packages/boot/app-boot/src/bundle-platform.ts`，并在 `profile-plugins.ts:reconcileProfilePlugins` 里校验）。**我们不声明 = 全平台，正确。**
- `dsh.bundle.listedByDefault?: boolean`：GUI 列表是否在启用前展示；缺省 true。
- `optionalDependencies`：可选依赖声明（我们不用）。

### 与迁移相关的上游行为变化

- **`cordis.yml` / patch 持久化语义**（升级指南 `docs/upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees/guide.zh.md`）：Include 1.1.1 起，运行时对 patch 插入行（含 bundle 行）的修改写入父级 patch；profile 根 Include 的父级是内存 Loader，因此这类修改重启后不再保留，此前会把整棵已应用 patch 的树写回 `cordis.yml`。**影响我们「插件页开关禁用后怎么恢复」的文档指引 → 待真机验证（#58）。**
- **退休 bundle**：`@deepseek-ai/dsh-experimental-schedule-bundle` 在 `RETIRED_BUNDLES` 中，升级到含它的版本时会自动从 profile 的 `bundles` 列表移除（不报错）。
- **`fs-observation-policy` 默认关闭**（0.2.2-alpha.2 起）：只影响 agent 写文件前是否必须先读，与搬运无关。
- `reportSkippedBundles` 的 stderr 文案（`skipping profile bundle "<名字>": <原因>`）**未变** → 我们释放后自检的解析仍然有效。
- **安装期审批来自 pnpm，不是 DSH**：`Agent skills awaiting approval: … Run "pnpm approve" to review them.` 是 pnpm 12（本机 12.11.2）`default-reporter` 的供应链策略文案，对 registry / git / tgz 解析出的包生效；本地目录 `link:` 不解析归档，所以不触发。文档里不要把这条描述成"DSH 插件审批"。

## 行动清单（按优先级）

| 优先级 | 事项 | 状态 |
|---|---|---|
| P0 | 0.2.2 上加载插件 | **无阻塞**（静态调查结论，真机待验 #58） |
| P1 | peer 范围补 `^0.2.2-rc.1`（DSH 门禁不要求，pnpm 安装告警需要） | 待办 #60 |
| P1 | README / 技能补 0.2.2 与 Node ≥24.9 要求 | 待办 #57 |
| P2 | 可选：给插件自己的 `settings.section` 加导航图标、HTTP 端点改用 `resource`、客户端图片走 `assets` 约定、用 `locale/<lang>.json` 的 `meta.detail`（指向 `docs/*.md`，支持 ≤5 MiB 预览图）在 Plugins 页展示正式详情 | 不需要 |

## 验证到什么程度

- **已由 CI 自动化验证（0.2.2-rc.1，run 42403338691 的 `ci / compat-next`）**：安装 `@deepseek-ai/dsh@next` → 集成测试 `# pass 1 / # fail 0` → 建 web profile 装本插件 → layer 断言 → 起服务 → `/api/dsh-migrate/state` 返回 `ok:true` 且 version 与 package.json 一致 → `== compat ok: @deepseek-ai/dsh@next (0.2.2-rc.1)`。

## 未验证项（人工/浏览器）

- 0.2.2-rc.1 上按钮在浏览器里的实际渲染（Web UI 客户端半边，需人工点一次）
- 插件页开关在 0.2.2 上的持久化位置
- 0.2.2 上 `dsh plugin add <本地目录/tgz>` 的 pnpm peer 警告实际文案（CI 走的是本地目录安装，日志未见拒绝）

## 复现调查的方法

```sh
# 版本与依赖
npm view @deepseek-ai/dsh dist-tags versions
npm view @deepseek-ai/dsh@0.2.2-rc.1 dependencies
# 官方仓库 tag 树 + 单文件内容
gh api "repos/deepseek-ai/deepseek-harness/git/trees/dsh-v0.2.2-rc.1?recursive=1" > tree.json
gh api "repos/deepseek-ai/deepseek-harness/contents/packages/boot/app-boot/src/plugin-compatibility.ts?ref=dsh-v0.2.2-rc.1" --jq .content | base64 -d
# 提交范围
gh api "repos/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.2-rc.1"
```

> 注：官方仓库的 Pull Request 功能未启用（`gh pr view` 报 `Pull requests are disabled`），调查以 commit / tag / 文件内容为准。
