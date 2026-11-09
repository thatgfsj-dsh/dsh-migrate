# 人工验收清单

自动化能覆盖到的部分都在 CI 里跑（三平台矩阵 + release 工作流的三平台解压验收，PR 阶段按 #59 规约不跑）。下面这些**必须有真机、最好有浏览器**才能下结论，逐条勾选；文件末尾的三平台专项把议题 #18 / #19 / #20 的验收点逐条对齐，并标注哪些已经被自动化覆盖。

## 自动化覆盖（构建阶段 CI，`ci.yml` 三平台矩阵）

| 议题 | 验收点 | 自动化位置 | 结论 |
| --- | --- | --- | --- |
| #18 | CI windows job 全绿 | `.github/workflows/ci.yml` matrix `windows-latest` × node 24 | 构建阶段验证（PR 不跑） |
| #18 | 中文文件名 zip、空目录、软链解引用、`tar -tf` / `Expand-Archive` 互操作 | `test/zip.test.mjs`（round trip / 原生工具互操作 / 软链实体化） | 已覆盖，Windows job 实跑 |
| #18 | 路径超过 260 字符 | `test/zip.test.mjs`「a path longer than 260 characters round trips」 | 已覆盖，但 Windows 需 `LongPathsEnabled`（CI 已打开；宿主仍拒绝时该用例会 **skip 并打印诊断**，需实机复核） |
| #18 | 盘符 / 反斜杠 / JSON 转义重写 | `test/rewrite.test.mjs`（含 `C:\...` → `D:\...` 树级改写）；`test/release.test.mjs` 端到端在 Windows job 上即真实盘符路径 | 已覆盖 |
| #18 | `restore.cmd` 端到端（假 home） | `test/restore-tool.test.mjs`「tools/restore.cmd runs end to end through cmd.exe」 | 已覆盖（仅 Windows job 执行） |
| #18 | 执行位：manifest 记录 mode、能设则设 | `test/release.test.mjs`（manifest.mode + 释放后权限位）、`test/zip.test.mjs` | 已覆盖（POSIX 平台断言权限位，Windows 只记录） |
| #19 | CI macos job 全绿、`unzip -t`、`ditto -x -k` 解压结构、中文名 | `.github/workflows/ci.yml` matrix `macos-latest`；`test/zip.test.mjs` 原生工具互操作（darwin 分支跑 `ditto` 并断言无 `__MACOSX`） | 已覆盖 |
| #19 | `__MACOSX` / `.DS_Store` / `Thumbs.db` / `desktop.ini` 忽略 | `test/inventory.test.mjs`（classify 矩阵 + Finder/Explorer 垃圾文件不进归档） | 已覆盖 |
| #19 | `restore.sh` 执行位、纯 shell 端到端 | `test/restore-tool.test.mjs`（归档解压后执行位 + `sh restore.sh --yes` + 仓库内执行位） | 已覆盖（Windows job 跳过） |
| #19 | `osascript` 对话框命令构造 | `test/pick-path.test.mjs`（`choose file name` / `choose file with prompt`） | 已覆盖（构造层；真实弹窗待实机） |
| #20 | CI linux job 全绿、无 zenity/kdialog 兜底、headless 不崩 | `test/pick-path.test.mjs`（含真实 Linux 环境探测：无 `DISPLAY` 时**不 spawn** 任何对话框直接报不可用）；`test/plugin-tools.test.mjs`（回退默认目录并说明） | 已覆盖 |
| #20 | `restore.sh` 端到端、无 `DISPLAY` | `test/restore-tool.test.mjs`（Linux job 跑 `sh restore.sh`） | 已覆盖 |
| #19/#20 | 仓库与归档内的 POSIX 执行位 | `test/restore-tool.test.mjs`（`install.sh` / `tools/restore.sh` 的 git 执行位） | 已覆盖 |

> 说明：Windows 长路径用例是**能力门控**的——先由 CI 打开 `LongPathsEnabled`，若宿主仍拒绝创建 >260 路径，用例跳过并在日志里说明原因（不是产品缺陷的伪造通过）。真机验收时请按下面 Windows 专项第 1 条复核。

## 通用（三平台都做）

- [ ] 解压交付 zip（Windows 用资源管理器 / macOS 用 Finder / Linux 用 `unzip`），执行 `install.sh`/`install.cmd` 能装进测试 profile
- [ ] `dsh --profile <p> --dump-config` 里出现 `# == dsh-migrate` 与 `- id: dsh-migrate`，且**没有** `patch: entry ... not found`
- [ ] 启动冒烟：web 模板 profile 上 `dsh --profile <p> --help` 打印 web 用法并 exit 0（base 模板 profile 的 `--help` 会进 TUI 挂住：0.2.0-rc.2 与 0.2.1 实测，别拿它冒烟）
- [ ] 安装路径对照：同一份包，**本地目录**安装**没有**审批提示；**tgz** 安装（0.2.1+）出现 `Agent skills awaiting approval`，批准后 `dsh-migration` 技能才出现（#44）
- [ ] 重启 DSH 后，会话技能目录里出现 `dsh-migration`
- [ ] 对 agent 说「打包大肥鱼」→ 弹出**原生保存对话框** → 进度从 0 走到 100 → 报告里有 zip 路径与体积
- [ ] 把 zip 拷到另一个 home → 说「释放大肥鱼」→ 进度走完 → 报告里有目标 home、备份路径
- [ ] 释放后 `dsh --profile <p> --dump-config` 通过；插件行生效
- [ ] 升级路径（#46）：0.2.0 打的包在 0.2.1 runtime 上释放 → 重启后 `dsh --profile <p> --dump-config` 没有 `skipping profile bundle`；若有，释放报告里必须出现 ⚠️ 自检 与 `dsh plugin --profile <p> install` 建议
- [ ] 故意释放到一个非空 home → 生成 `<home>.bak-<时间>`，备份里有旧文件
- [ ] 在 zip 里塞一个假 `sk-` 字符串后重打包 → **必须中止**，且报告里是打码值
- [ ] 目标机 `node -v` 满足版本要求（0.2.2+ 需 ≥ 24.9）；否则先升 Node 再装 dsh
- [ ] 0.2.2-rc.1（当前 latest）上走一遍：装插件 → `--dump-config` 出现层 → 打包/释放各一次；结果贴回 #58

## 浏览器（Web UI 半边）

- [ ] 设置 → 插件 里出现「大肥鱼搬运」页签，页签内有【打包大肥鱼】【释放大肥鱼】两个按钮（输入框下方**不应**再有常驻入口）
- [ ] 控制台**没有** `slot entry crashed`
- [ ] 点【打包大肥鱼】→ 弹原生保存对话框 → 按钮变为进度文案 → 完成后显示 zip 路径
- [ ] 点【释放大肥鱼】→ 弹原生文件选择 → 进度走完 → 显示目标 home 与「已备份旧环境」
- [ ] 明暗主题各看一次，按钮与文案都清晰可读
- [ ] 与插件设置页其它分页签并排看，没有明显样式冲突
- [ ] 用 `dsh plugin --profile <p> remove dsh-migrate` 卸载后，页签消失且 `--dump-config` 里没有 `# == dsh-migrate`；再 `add <本地目录>` 装回来仍正常

## Windows 专项（#18）— 待实机人工验收

- [ ] **长路径**：造一个总长 >260 的 home（PowerShell）：
  ```powershell
  $deep = "C:\dsh-long\" + ((1..14 | % { "segment-$($_)" }) -join "\")
  New-Item -ItemType Directory -Path $deep -Force | Out-Null
  Set-Content -Path "$deep\AGENTS.md" -Value "# long path"
  # 把 $deep 当成 DSH_HOME 打包/释放各一次；要求不报 ENAMETOOLONG/ENOENT
  ```
  同时记录本机 `LongPathsEnabled` 值（`Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled`）：关闭时打包应给可读错误或提示，不能静默丢文件
- [ ] 归档里中文文件名在资源管理器中正常显示；`Expand-Archive` 后无乱码（中文 Windows 的 GBK 代码页下也要看一次）
- [ ] 资源管理器双击解压后目录结构正确（无多余层级、无 0 字节文件）
- [ ] `install.cmd` 装进测试 profile 能成功
- [ ] `dsh-migrate-tools\restore.cmd --home %TEMP%\dsh-test-home --yes` 在解压目录跑通（双击与命令行各一次）
- [ ] 原生保存 / 打开对话框（PowerShell WinForms）能弹出；默认目录与中文文件名正确；用户取消时工具报告「已取消」而不是报错
- [ ] 跨平台：把 Linux 上打的包在 Windows 上释放 → 报告里 `skipped` 列出 linux-only 二进制，其它内容正常
- [ ] 反向跨平台：Windows 上打的包在 Linux/macOS 上释放 → 盘符路径全部重写，`--dump-config` 无旧盘符残留
- [ ] 目标 home 位于另一个盘符（例如源机 `D:\Users\me\.dsh` → 目标机 `C:\Users\me\.dsh`）时，`profiles/*/package.json` 与 patch 文件里没有旧盘符/反斜杠残留
- [ ] 记录 `node -v` 与是否启用开发者模式（软链用例在无权限时是否按拷贝降级）

## macOS 专项（#19）— 待实机人工验收

- [ ] Finder 双击解压后没有多余的 `__MACOSX` 干扰；再用 `ditto -x -k <zip> <dir>` 复核一次结构
- [ ] `dsh-migrate-tools/restore.sh` 解压后仍有执行位：`ls -l dsh-migrate-tools/restore.sh` 看 `x`
- [ ] `sh dsh-migrate-tools/restore.sh --yes` 在纯 CLI 跑通（假 home）；`com.apple.quarantine` 存在时按需处理：
  ```sh
  xattr -l dsh-migrate-tools/restore.sh   # 看是否有 com.apple.quarantine
  xattr -dr com.apple.quarantine <解压目录>  # 或 Finder 里右键「打开」放行
  ```
- [ ] 若系统提示「来自身份不明的开发者」/Gatekeeper 拦截：记录提示原文与放行步骤（不是让用户关 SIP）
- [ ] `osascript` 保存/打开对话框能弹出并返回正确 POSIX 路径；取消（AppleScript error -128）时工具报告「已取消」
- [ ] Apple Silicon 机器释放 Intel / linux-only 二进制 → `skipped` 报告正确，插件本体仍可用
- [ ] **缺口待补**：当前没有可双击的 `restore.command`（只有 `restore.sh`），Finder 双击会打开编辑器。双击入口属于 #19 交付项，需另开 PR/议题补（本清单不勾）
- [ ] 在「中文（简体）」与空 locale 下各解压一次，文件名无乱码

## Linux 专项（#20）— 待实机人工验收

- [ ] GNOME（zenity）环境弹一次保存/打开对话框；KDE（kdialog）环境各弹一次
- [ ] Wayland 会话（只有 `WAYLAND_DISPLAY`、没有 `DISPLAY`）下仍能弹窗（zenity 走 Wayland 后端）
- [ ] 在没有 `zenity`/`kdialog` 的环境里打包 → **回退到默认目录**（`~/Downloads`）并在报告里说明「无法弹出对话框」，不崩、不静默覆盖
- [ ] 在没有 `DISPLAY`/`WAYLAND_DISPLAY` 的环境（ssh / headless）里：打包工具直接走默认目录并在报告说明；`fatfish_release` 不带 `zipPath` 时返回可操作的提示而不是抛栈
- [ ] `sh dsh-migrate-tools/restore.sh --yes` 在纯 CLI 跑通（假 home），执行位保留
- [ ] 用一个最小容器镜像（`docker run --rm -v ... node:24 sh`）复核 headless 路径一次，确认没有依赖 `unzip` 以外的系统工具
- [ ] 文件权限与 manifest 记录的 mode 一致：随机抽 2 个 `.sh`/无扩展名文件 `ls -l` 对照

## 记录方式

每条勾选后把命令、输出、截图（如需要）贴回对应议题（#18 / #19 / #20）或本文件的 PR 评论里。**没有跑过的项目不要勾**；CI 自动覆盖的条目请在构建阶段的 Actions 运行链接里复核，不要把「本地静态检查」写成「已实机验证」。
