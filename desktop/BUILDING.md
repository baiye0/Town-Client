# 构建、打包与交付

本文对应 `package.json`、`scripts/build-portal.mjs`、`scripts/prepare-desktop.mjs` 和 `forge.config.ts`。桌面版本由 `package.json` 决定（当前 0.1.0）；根目录 `VERSION` 的 1.3.0 是原单文件 Loom 的版本，二者独立。

## 支持范围与前置条件

| 环境 | 前置条件 | 当前交付状态 |
| --- | --- | --- |
| macOS | Git、Node.js 22.12+、npm、Rust stable、Xcode Command Line Tools | 已在 Apple Silicon 本机构建 `.app` / ZIP 并运行；Intel 需对应 x64 机器另行构建 |
| Windows | Git、Node.js 22.12+、npm、Rust stable MSVC 工具链、Visual Studio C++ Build Tools 和 Windows SDK | 配置了 ZIP / Squirrel Setup；Windows 原生构建、安装和后台任务仍需实机验收 |
| Linux | Git、Node.js 22.12+、npm、Rust stable、本机 C/C++ 链接工具及 Electron 桌面运行依赖、密钥库 | 配置了 ZIP；后台常驻未实现，未完成 Linux 桌面验收 |

这些是源码构建条件。使用已打包客户端进行聊天、运行内置 Portal 不需要另装 Node 或 Rust。特定 Kit 可能另需 Node/Python、账号凭据或外部 CLI，安装窗口会说明依赖。

Electron 与 Portal 必须来自同一目标操作系统和架构。目前脚本按**当前机器**构建，不提供交叉编译或 universal 包。不要单独给 Forge 加 `--arch` / `--platform` 来制作另一平台的包；也不要为本流程设置 `CARGO_BUILD_TARGET`、`CARGO_TARGET_DIR` 或 Cargo 的自定义 target-dir，否则脚本预期的 `target/release` 路径可能与实际输出不符。

## 从全新克隆开始

Portal 源码直接包含在 `heart-portal/` 目录中，和客户端一起提交。以下命令可在 macOS/Linux shell 或 Windows PowerShell 中逐行执行。

```text
git clone https://github.com/baiye0/Town-Client.git
cd Town-Client
npm ci
npm run build:portal
npm start
```

普通克隆和 GitHub Download ZIP 都包含完整 Portal 源码，不需要子模块初始化。更新客户端时也会取得对应版本的引擎代码。

### 更新 Portal

直接修改或合入经审核的 Portal 源码，在客户端和引擎验证通过后一起提交。`heart-portal/` 是本仓库的普通目录，不单独 checkout 或推送；保留其许可声明，并在需要时更新根目录 `UPSTREAM.md` 的来源记录。

仓库不提交 `node_modules/`、Portal 二进制、生成的网页资产或 `out/`。`npm ci` 根据 `package-lock.json` 安装依赖；首次构建需要联网下载 Electron、npm 包和 Cargo 依赖。`npm start` 先生成离线网页资产，再启动开发模式。

源码位于其他位置时，设置 `HEART_PORTAL_SOURCE`：

macOS / Linux：

```bash
export HEART_PORTAL_SOURCE="/absolute/path/to/heart-portal"
npm run build:portal
```

Windows PowerShell：

```powershell
$env:HEART_PORTAL_SOURCE = 'C:\code\heart-portal'
npm run build:portal
```

`build:portal` 执行 `cargo build --release --locked -p heart-portal`，复制结果到 `resources/heart-portal`（Windows 为 `heart-portal.exe`）。准备步骤只在该资源**不存在**时自动复制子模块源码的 release 引擎，不会自动替换已有引擎；Portal 源码更新后应显式重跑 `npm run build:portal`。`HEART_PORTAL_SOURCE` 同时影响构建、准备和完整测试流程，正式交付时应使用主仓库锁定的子模块版本。

## 构建命令与产物

在仓库根目录执行：

```text
npm run build:portal
npm run package
npm run make
```

`package` 生成可运行目录；`make` 会自行再次执行 package，并制作分发包，所以仅需分发包时可以跳过独立的 `npm run package`。两者都会生成本地聊天资源，不运行自动化测试。

| 命令 / 平台 | 输出位置（`<arch>` 为当前架构，`<version>` 为桌面版本） |
| --- | --- |
| package / macOS | `out/Beings-darwin-<arch>/Beings.app` |
| package / Windows | `out/Beings-win32-<arch>/beings.exe`，必须连同所在目录的其他文件使用 |
| package / Linux | `out/Beings-linux-<arch>/beings`，必须连同所在目录的其他文件使用 |
| make / ZIP | `out/make/zip/<platform>/<arch>/Beings-<platform>-<arch>-<version>.zip` |
| make / Windows Setup | `out/make/squirrel.windows/<arch>/Beings-<version> Setup.exe`，同目录另有 `RELEASES` 和 `beings-<version>-full.nupkg` |

ZIP 含完整应用目录和内置 Portal。不要只拷贝 Windows 的单个 exe 或 macOS `.app` 中的单个可执行文件。当前没有 DMG、MSI、AppImage、deb/rpm，也没有自动发布到 GitHub Releases 的命令。

macOS 可将解压后的 `Beings.app` 放到 Applications 或稳定的用户目录再启动。Windows ZIP 应解压到当前用户可写的稳定目录再运行 `beings.exe`，不要直接在压缩包预览里启动。

### Windows 安装包的明确边界

客户端已处理 Squirrel 安装、更新和卸载事件，由安装程序创建或移除快捷方式；这些短进程不会启动 Portal。Windows Setup 升级及后台任务仍需实机验收。

当前均为未签名的开发/试用包：未配置 macOS Developer ID、公证、Windows Authenticode、应用自动下载/替换。操作系统可能提示来源未验证；正式公开发布前应配置签名并在目标系统验收。Electron 的下载校验不等于应用代码签名。

## 网络与常见失败

如果 Electron 下载失败，可在当前终端临时设置镜像后重试原先失败的 `npm ci` 或构建命令；镜像只影响 Electron 下载，npm registry 和 Cargo 仍使用各自配置。

macOS / Linux：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm ci
npm run make
```

Windows PowerShell：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm ci
npm run make
```

| 问题 | 处理 |
| --- | --- |
| `Portal source missing from heart-portal/` | 恢复仓库中的 `heart-portal/` 源码目录，或设置 `HEART_PORTAL_SOURCE` |
| `Portal binary missing` | 先完成 `npm run build:portal`；聊天开发模式可缺少引擎，package/make 不允许缺少内置引擎 |
| `cargo` / `link.exe` 找不到 | 安装 Rust 和目标系统链接工具，重开终端确认 PATH；Windows 使用 MSVC 工具链 |
| 构建成功但引擎启动失败 / 架构错误 | 用同平台、同架构 Node 和 Rust 重新构建，勿复用另一台机器的 `resources/` 二进制 |
| Windows 构建无法覆盖文件 | 先退出正在运行的 `out/` 客户端，再构建；后台 Portal 运行于独立目录，不需要批量结束 Portal 进程 |
| 客户端提示系统加密不可用 | 在已登录桌面会话和可用系统密钥库下运行；Linux 不支持明文凭据降级 |
| 改了源码但打开仍是旧 UI | 重新 make 后完全退出旧进程，再启动新 `.app` / exe；仅替换磁盘文件不会更新内存中的旧进程 |

不要把真实 Being 链接、Town token、个人 Portal 配置或 Kit 密钥写进源码、构建参数、提交或分发包。

## 升级、重启与卸载

客户端设置位于 Electron 的用户数据目录（通常 macOS 为 `~/Library/Application Support/Beings`，Windows 为 `%APPDATA%\Beings`，Linux 为 `$XDG_CONFIG_HOME/Beings` 或 `~/.config/Beings`）。`BEINGS_USER_DATA` 会覆盖该目录，仅用于隔离开发/测试 profile。

客户端采用手动安装新版本、首次启动自动同步 Portal 与守护的配套升级方式。先结束本机任务并保存草稿，退出旧客户端并安装新版，再重新打开。配置、Kits、凭据和工作目录保留；停止状态保留，失败恢复旧服务。详细范围、发布和恢复流程见 [UPDATING.md](UPDATING.md)。

卸载前若不再需要本机能力，在「本机 Portal」点击「停止」，确认后台常驻和登录自启已停用，再移除客户端。删除客户端安装目录本身不会卸载后台服务，也不会删除用户配置或 Kit 凭据。由客户端识别并沿用的服务同样需要先停用；不要按进程名批量杀死其他 Portal。

## 验证与 CI

静态类型检查：`npm run typecheck`。完整测试及覆盖边界见 [TESTING.md](TESTING.md)。`npm run test:all` 会构建 package，但本地不会顺带生成 make 分发包；发布前还需执行 `npm run make`。

Push / PR 的 GitHub Actions 在 macOS 和 Windows 运行测试，通过后执行 make，并上传分发包和测试报告（保存 14 天）。上传 artifact 不会创建 Release 或安装到用户机器。托管 runner 跳过真实登录服务测试；可通过手动 `native_background` job 使用专用已登录 Mac runner。Windows 原生后台任务、睡眠唤醒以及其他平台仍需实机验收。

每次交付记录客户端 commit、桌面版本、Portal commit、平台/架构和验证范围。更新桌面版本使用 `npm version <新版本> --no-git-tag-version` 同步 `package.json` / lockfile，然后重新构建；不要只改原网页的 `VERSION`。依赖风险应以交付时重新执行的 `npm audit` 为准，README 中的历史构建记录不代表永久无漏洞。
