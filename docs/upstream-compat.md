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
| `0.2.2-rc.1`（当前 `latest`） | ✅ **CI 自动化 + 本机隔离 home 行为验证**（2026-11-08 / 2026-11-10） | **4.1.0** | **3.19.0** | **`>=24.9.0`** | `ci / compat-next` 实跑通过（安装、组合层、端点）；本机 0.2.2-rc.1 上真机验证了插件页开关持久化、bundle platforms 准入、退休 bundle 自动移除三项行为（见「0.2.2 真机验证记录」）。浏览器内按钮渲染仍待人工 |

> `0.2.2-rc.1` 发布于 2026-11-04。npm dist-tags 当时为 `latest = 0.2.2-rc.1`、`next = 0.2.2-rc.1`、`alpha = 0.2.2-alpha.3`。

当前插件 `peerDependencies`（#60 之后）显式列出三条 rc 线：`@deepseek-ai/dsh-tools: ^0.2.0-rc.2 || ^0.2.1-rc.2 || ^0.2.2-rc.1`。上游门禁本来就会用 `includePrerelease` 放行 0.2.2-rc.1，补这一条是为了消除 pnpm/npm 的 unmet peer 警告；为什么不用 `engines.dsh` 合并声明见下文[评估](#enginesdsh-单一声明评估60结论不采用)。

## Node.js 版本要求（#57）

| 目标 DSH 版本 | Node 要求 | 来源 |
|---|---|---|
| `0.2.2-rc.1`（当前 `latest`） | **`>=24.9.0`** | `apps/cli/package.json@dsh-v0.2.2-rc.1` 的 `engines.node`；`npm view @deepseek-ai/dsh@0.2.2-rc.1 engines` 同值 |
| `0.2.0-rc.2` / `0.2.1-rc.2` | `^22.19.0 || >=24.0.0`（本包 `engines.node`；上游这两条线未声明 `engines.node`） | `npm view @deepseek-ai/dsh@0.2.1-rc.2 engines` 为空；22.19+ 是包内 action 实际可用的下限 |

释放报告里的 Node 检查（`lib/core/verify.mjs` 的 `nodeRequirementFor()` / `runtimeReport()`）按**目标 DSH 版本**取上表下限，低于下限给 warning——`24.8.0` 对 `>=24.9.0` 会报，不再只看主版本。目标 DSH 版本取「本机检测到的 dsh，否则归档 `manifest.source.dsh`」。README 的「支持的 DSH 版本」段与随包技能（`references/workflow.md`、`references/troubleshooting.md`）给出同一套要求与 `node -v` 自查。

## `engines.dsh` 单一声明评估（#60，结论：不采用）

上游 `packages/boot/app-boot/src/plugin-compatibility.ts`（0.2.2-rc.1）的判定顺序是：插件自己有 `engines.dsh` 时**只**看它（`peerDependencies` 被忽略）；没有才回退到 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peers，且用 `semver.satisfies(runtime, range, { includePrerelease: true })`。

不采用的理由：

1. **省不掉每版改范围**：pnpm 的 peer 解析**不带** `includePrerelease`，prerelease 只认同一 `M.m.p` 元组上的 comparator，所以 peer 仍必须逐条列出每个 rc 线（#47 约定）。`engines.dsh` 只能替掉「上游门禁」这一份，而门禁本来就会随 `includePrerelease` 自动接受同一 0.2.x 线上的新 rc（现有 `^0.2.2-rc.1` 在门禁眼里已覆盖 `0.2.3-rc.1` 这类未来 rc），并没有卡住我们。
2. **反而引入两份真相**：peer 要保留给 pnpm，就变成 peer + `engines.dsh` 两处声明，还得加测试保证一致；一旦不一致，门禁会静默改用 `engines.dsh` 而忽略 peer，故障面更大。
3. **上游官方包也没用**：本机 `@deepseek-ai/dsh@0.2.2-rc.1` 安装树里所有 `@deepseek-ai/dsh-*` 包都只有 peers 声明，`engines.dsh` 实测 0 命中。这是门禁的逃生舱，不是发布约定。

结论：保持 `peerDependencies` 为唯一声明，由 `test/peer-ranges.test.mjs` 守着「每条 rc 线必须显式列出 + `0.3.0` 必须拒绝」。若将来 pnpm 的 peer 解析支持 `includePrerelease`，或我们决定改走 `engines.dsh`，再按 #60 的备选方案同时保留 peer 并加测试校验两者一致。

## 对插件的影响面（0.2.1-rc.2 → 0.2.2-rc.1 静态调查）

| 影响面 | 结论 | 要改代码？ |
|---|---|---|
| 包清单 `dsh.bundle` / `dsh.client` / `icon` / `exports` | 兼容；仅新增可选字段（见下） | 否 |
| 兼容性门禁 `packages/boot/app-boot/src/plugin-compatibility.ts` | **逐字未变**；判定用 `semver.satisfies(runtime, range, { includePrerelease: true })`，现有 peer 范围在 0.2.2-rc.1 仍通过（#60 已显式补上 0.2.2 rc 线以消除 pnpm 警告） | 否 |
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

- **`cordis.yml` / patch 持久化语义**（升级指南 `docs/upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees/guide.zh.md`）：Include 1.1.1 起，运行时对 patch 插入行（含 bundle 行）的修改写入父级 patch；profile 根 Include 的父级是内存 Loader，因此这类修改重启后不再保留，此前会把整棵已应用 patch 的树写回 `cordis.yml`。**0.2.2 真机已验证（#58）：插件页开关由 plugin-manager 显式改写 profile 的 `cordis.patch.yml`（不是靠 loader 的树写回），重启保留；该语义变化不影响我们 README 的恢复指引，措辞已按实测形式微调（见下文验证记录）。**
- **退休 bundle**：`@deepseek-ai/dsh-experimental-schedule-bundle` 在 `RETIRED_BUNDLES` 中，升级到含它的版本时会自动从 profile 的 `bundles` 列表移除（不报错）。
- **`fs-observation-policy` 默认关闭**（0.2.2-alpha.2 起）：只影响 agent 写文件前是否必须先读，与搬运无关。
- `reportSkippedBundles` 的 stderr 文案（`skipping profile bundle "<名字>": <原因>`）**未变** → 我们释放后自检的解析仍然有效。
- **安装期审批来自 pnpm，不是 DSH**：`Agent skills awaiting approval: … Run "pnpm approve" to review them.` 是 pnpm 12（本机 12.11.2）`default-reporter` 的供应链策略文案，对 registry / git / tgz 解析出的包生效；本地目录 `link:` 不解析归档，所以不触发。文档里不要把这条描述成"DSH 插件审批"。

## 行动清单（按优先级）

| 优先级 | 事项 | 状态 |
|---|---|---|
| P0 | 0.2.2 上加载插件 | **无阻塞**（0.2.2-rc.1 本机隔离 home 真机验证，见下文） |
| P1 | peer 范围补 `^0.2.2-rc.1`（DSH 门禁不要求，pnpm 安装告警需要） | **已完成 #60**：`^0.2.0-rc.2 \|\| ^0.2.1-rc.2 \|\| ^0.2.2-rc.1`，`test/peer-ranges.test.mjs` 覆盖 0.2.2-rc.1 且拒绝 0.3.0 |
| P1 | README / 技能补 0.2.2 与 Node ≥24.9 要求 | **已完成 #57**：README 版本段、`references/workflow.md`/`troubleshooting.md` 的 `node -v` 自查、释放报告按目标 DSH 版本给 Node 下限 warning |
| — | 评估 `engines.dsh` 单一声明 | **已评估，不采用**（理由见上文「`engines.dsh` 单一声明评估」） |
| P2 | 可选：给插件自己的 `settings.section` 加导航图标、HTTP 端点改用 `resource`、客户端图片走 `assets` 约定、用 `locale/<lang>.json` 的 `meta.detail`（指向 `docs/*.md`，支持 ≤5 MiB 预览图）在 Plugins 页展示正式详情 | 不需要 |

## 0.2.2 真机验证记录（0.2.2-rc.1，本机隔离 home，2026-11-10）

环境：`dsh 0.2.2-rc.1`（npm `latest`）、Node `v24.21.0`、Linux x86_64。
隔离方式：`DSH_HOME=/tmp/verify58/home`（临时目录，先跑 `scripts/assert-isolated-home.mjs` 守卫通过），profile `v022` 由 `dsh --profile v022 --from-default-profile web` 创建，插件用 `dsh plugin --profile v022 add <本仓库>` 安装。**真实 `~/.dsh`（正在跑 Web GUI）全程未读写**；服务一律 `dsh --profile v022 --host 127.0.0.1 --port 0 --no-open` 启动，端口与 launch token 从启动日志读取。实验产物（临时 home、日志、进程）结束前已清理。

### 1. `cordis.yml` / `cordis.patch.yml` 持久化（插件页开关）—— ✅ 已验证；README 指引仍成立，措辞按实测微调

**安装后的位置**：`dsh plugin add` 把插件自动并入 `dsh.profile.bundles`（`["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-migrate"]`），行来自插件自带的 bundle patch 层：

```text
# == dsh-migrate
- id: dsh-migrate
  name: dsh-migrate
  config: {}
```

此时 profile 的 `cordis.yml` 与 `cordis.patch.yml` 都还是模板里的 `[]`。

**无头「点开关」**：插件页开关调用 `ctx.remote.pluginManager.setPluginEnabled(entryId, enabled)`，其单次调用在 HTTP 上就是 `POST /api/pluginManager/setPluginEnabled`（先用 `GET /?token=<launch token>` 换浏览器 cookie）：

```sh
curl -sS -c cookies.txt "http://127.0.0.1:$port/?token=$token"          # 303 + Set-Cookie
curl -sS -b cookies.txt -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"<uuid>","method":"pluginManager/setPluginEnabled",
       "payload":{"args":{"id":"include:dsh-migrate","enabled":false}}}' \
  "http://127.0.0.1:$port/api/pluginManager/setPluginEnabled"
# -> {"ok":true,"value":{"stage":"enable","target":"include:dsh-migrate","enabled":false,
#                        "changed":true,"application":"applied","warnings":[]}}
```

`application:"applied"` = HMR 立即生效，不要求重启。写入位置（关键）：

```text
$ cat $DSH_HOME/profiles/v022/cordis.patch.yml
[ { id: dsh-migrate, disabled: true } ]     # 注释头保留；模板的 [] 变成单行 flow
$ cat $DSH_HOME/profiles/v022/cordis.yml
[]                                          # 没有被写回
$ ls $DSH_HOME/cordis.patch.yml             # home 级 patch 不参与
ls: cannot access ...: No such file or directory
```

**重启后保留**（新进程）：`dsh --profile v022 --dump-config` 输出

```text
# == dsh-migrate, patched by /tmp/verify58/home/profiles/v022/cordis.patch.yml
- id: dsh-migrate
  name: dsh-migrate
  config: {}
  disabled: true
```

重启后的服务里 `pluginManager/listPlugins` 仍是 `enabled:false`；带 cookie 请求 `GET /api/dsh-migrate/state` → `404 not found`（插件自己的端点不再注册；不带 cookie 时落到通用 `/api` RPC 通道会得到 401，两种情况都说明端点已消失）。

**按 README 恢复**：删掉 `cordis.patch.yml` 里 `id: dsh-migrate` 那条覆盖（回到 `[]`）→ `--dump-config` 的行不再有 `disabled`；重启后 `enabled:true`、`GET /api/dsh-migrate/state` → `200 {"ok":true,"home":"/tmp/verify58/home","version":"0.1.2",…}`。README 里手写的 block 形式 `- id: dsh-migrate` / `disabled: true` 在 0.2.2 上同样有效（`--dump-config` 显示 `disabled: true`）。

**结论（已验证）**：

- 0.2.2 上插件页开关的持久化位置仍是 **profile 的 `cordis.patch.yml`**（不是 `cordis.yml`），重启保留；删掉该覆盖即可恢复 → README 的恢复指引**仍然成立**。
- 升级指南所说的「运行时修改写父级 patch、profile 根 Include 的父级是内存 Loader → 重启不保留」描述的是 **loader 的树写回语义**（0.2.2 起不再把整棵已应用 patch 的树写回 `cordis.yml`）；插件页开关走的是 plugin-manager 显式改写 profile patch 的路径（源码核对：`writePluginEnabled`），不受该变化影响。
- **措辞需微调**（已改 README 排障段与技能排障表）：0.2.2 实际写成单行 flow `[ { id: dsh-migrate, disabled: true } ]`，「删掉这两行」改为「删掉 `id: dsh-migrate` 那条覆盖」。
- **待人工**：浏览器里实际点击开关的渲染/交互（持久化语义已用 GUI 同一 RPC 无头验证）。人工步骤：隔离 home 起服务 → 打开启动日志里的 `?token=` URL → 设置 → 插件 →「大肥鱼搬运」页签关掉开关 → 看 `profiles/<p>/cordis.patch.yml` 是否出现该覆盖 → 重启后再看页签/工具是否消失。

### 2. `dsh.bundle.platforms` 准入 —— ✅ 已验证（含负对照）

**本插件不声明 platforms（=全平台）**：

```sh
$ node -e 'const p=require("./package.json");console.log(JSON.stringify(p.dsh.bundle))'
{"patch":"./cordis.patch.yml"}          # platforms 为 undefined
$ dsh plugin --profile v022 add /path/to/dsh-migrate   # exit 0
$ dsh --profile v022 --dump-config | grep -A3 '^# == dsh-migrate'   # 行正常
$ grep -iE 'UnsupportedBundlePlatformError|Bundle supports Host platforms' <启动日志>   # 无命中
```

**负对照（证明 0.2.2 的准入检查真的在生效）**：造一个 `"dsh": {"bundle": {"platforms": ["win32"], "patch": "./cordis.patch.yml"}}` 的 fixture bundle，在 linux 上安装：

```text
$ dsh plugin --profile pfix add /tmp/verify58/fixture-winonly   # exit 1
dsh: bundle activation rejected: dsh-migrate-fixture-winonly: Bundle supports Host platforms win32; the DSH Host is running linux
dsh: installed dependencies remain; bundle selection is unchanged. Use a supported Host or remove the unwanted dependencies with 'dsh plugin remove <package>'.
# profile 的 bundles 列表保持 ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]
```

把该 bundle 手工写进 `bundles` 再启动：stderr 出现 `dsh: skipping profile bundle "dsh-migrate-fixture-winonly": UnsupportedBundlePlatformError: Bundle supports Host platforms win32; the DSH Host is running linux`——启动不崩，只跳过该层。

**结论（已验证）**：本插件在 0.2.2 linux 上安装/启动不抛 `UnsupportedBundlePlatformError`；「不声明 = 全平台」在 0.2.2 仍成立，无需改代码。将来若要加平台限制，必须写全三平台，否则会被同一道检查拒掉。

### 3. 退休 bundle 自动移除 —— ✅ 已验证

构造 0.2.1 归档释放到 0.2.2 home 后的典型状态（profile 的 `dsh.profile.bundles` 里含退休包）：

```sh
# 往 profiles/v022/package.json 的 bundles 里插入 @deepseek-ai/dsh-experimental-schedule-bundle
injected -> ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-experimental-schedule-bundle","@deepseek-ai/dsh-web-app","dsh-migrate"]
$ dsh --profile v022 --dump-config          # exit 0，stderr 为空
# 之后 package.json：
"bundles": ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-migrate"]   # 退休项已被移除
$ grep -iE 'patch: entry .* not found' <dump 输出与 stderr>   # 无命中
$ dsh --profile v022 --host 127.0.0.1 --port 0 --no-open      # 正常启动
$ curl .../api/dsh-migrate/state                              # 200
```

移除发生在 `loadProfileDirectory → dropRetiredBundles`，**早于** bundle 解析：无论退休包是否还留在 `node_modules`，列表都会被清掉；启动日志没有 retired / schedule-bundle 相关报错。

**结论（已验证）**：0.2.2 上退休 bundle 会被静默移除，不产生 `patch: entry not found`；我们释放后自检解析的 `skipping profile bundle` 文案也不受影响。

> 三项实验的日志是临时产物，已清理；上面命令可直接复跑。

## 验证到什么程度

- **已由 CI 自动化验证（0.2.2-rc.1，run 42403338691 的 `ci / compat-next`）**：安装 `@deepseek-ai/dsh@next` → 集成测试 `# pass 1 / # fail 0` → 建 web profile 装本插件 → layer 断言 → 起服务 → `/api/dsh-migrate/state` 返回 `ok:true` 且 version 与 package.json 一致 → `== compat ok: @deepseek-ai/dsh@next (0.2.2-rc.1)`。
- **已由本机隔离 home 真机验证（0.2.2-rc.1，2026-11-10）**：插件页开关的持久化位置与恢复路径、`dsh.bundle.platforms` 准入（含负对照）、退休 bundle 自动移除（命令与输出见「0.2.2 真机验证记录」）。

## 未验证项（人工/浏览器）

- 0.2.2-rc.1 上按钮在浏览器里的实际渲染（Web UI 客户端半边，需人工点一次）
- 插件页开关在浏览器里的实际点击交互（持久化语义已用 GUI 同一 RPC 无头验证，见上）
- 0.2.2 上 `dsh plugin add <本地目录/tgz>` 的 pnpm peer 警告实际文案（CI 走的是本地目录安装，日志未见拒绝；#60 补范围后需真机确认 tgz 安装不再报 unmet peer）
- 目标机 Node 24.8 上跑一次释放，确认报告出现「Node 版本过低」warning（#57 的代码用例已单测覆盖，真机文案待确认）

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
