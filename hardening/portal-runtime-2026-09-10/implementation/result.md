# Portal 精简架构实现记录

起点：`heart-portal` 的 `2dab52fc081d80a7bda9ce7735ab50c6cc6726ac`；实现分支：`codex/portal-runtime-minimal`。代码改动留在工作区，未提交、推送或替换用户已安装的服务。外层已有 Town/UI 等修改保持原样。

## 已实现

- 保留一个 Rust Portal 和现有平台守护。未增加数据库、常驻服务、任务平台或自研沙箱。
- `ChildProcess` 统一 shell、截图命令和 MCP 的生命周期。macOS 使用进程组，观察退出后先清理后代再回收 leader；Windows 在挂起状态加入 kill-on-close Job Object 后恢复。MCP 有退出观察任务，最终响应先排空，退出后的子进程不会继续占着协议管道。
- 连接内请求并发执行，共享有限名额，ping/process 控制请求另有预留容量。同步任务随连接取消；显式后台任务允许跨网络重连，重启后状态未知，不自动重放命令。
- 协议读取、写入、命令输出、历史记录、回调并发及文件/网页响应有界。kit 冷启动使用各自的锁；全局 registry 不再等待进程启动或 RPC。
- 调用入口执行工具开关；保留内置工具名，阻止自定义工具覆盖。新安装默认关闭执行、可执行扩展和截图。已有配置的权限语义保留；独立本地 TCP 现在必须配置 token，缺失时在启动工具前报错。
- 文件实际 I/O 使用 `cap-std` 的目录句柄；读取限长，写入原子替换，截图先写临时目录。增加 `cap-std`、`tempfile` 两个直接依赖，以复用跨平台实现，避免自写两套文件系统安全逻辑。
- web_fetch 使用项目已有 reqwest；逐次校验跳转及 DNS 地址并固定解析结果，不再调用 curl。回调与 relay 共用精确 loopback 明文例外，远程采用 TLS，token 按 URL 参数编码。
- 桌面托管、后台管理和独立服务观察使用带 PID、启动标识、boot ID、序号、时间的状态。日志仅作诊断；拒绝陈旧或不属于当前实例的状态。状态标识与升级事务标识分开。无法确认停止时明确报错，不无限等待或误报已停止。
- Windows 本地升级不再先运行候选 `--version`；验证候选字节的官方发布摘要后才进入既有升级事务。构建脚本也先写临时文件再替换 bundled Portal。

## 与设计的明确取舍

Windows 尚无可用发布签名配置。本次复用已有 GitHub HTTPS 发布元数据 + SHA-256 信任链，同时用于在线和本地文件更新；没有假称完成 Authenticode。`upgrade --file` 仅接受官方最新且比当前新的发布，需要联网，社区未发布构建须显式开发安装。这偏离原稿“本地候选必须有可信签名证明”的表述，保留“执行前验证来源”的要求，避免引入未经部署的签名体系。正式 Windows 签名发布仍是后续发布工作。

本地 TCP 选择始终要求 token，没有加入无认证开发旁路。macOS 无配置首次启动使用当前用户目录；显式旧配置仍保留。通用 shell/kit 是可信用户代码，进程组与 Job Object 只管理生命周期，不承诺恶意代码隔离或跨用户保护。

## 验证

- Rust：160 项中 **155 通过、5 忽略**。其中 2 个忽略项是由活跃回归测试显式启动的子进程 fixture，另 3 个原已忽略。新增覆盖超时/取消/正常退出清理后代、MCP 最终响应、同连接 ping、调用入口策略、并发名额、认证、文件限长、链接边界和 kit 启动锁。
- 桌面 Portal 专项单元测试：**14/14 通过**；TypeScript 类型检查通过。
- macOS 真实生命周期：**5/5 通过**，包含临时 LaunchAgent、崩溃恢复、重复实例、真实 Relay 重连/重启及结构化状态。
- macOS 签名策略测试：**3/3 通过**。这是验证现有签名策略的测试，不意味着本地产物已正式签名或公证。
- Rust release 构建、桌面 macOS ARM64 打包通过。新增 `npm run test:portal-e2e` 验证打包客户端通过 IPC 启动真实引擎，完成文件写入、禁用执行、目录边界、重连保持 PID 和停止清理；使用临时 profile 和本地模拟 Being。
- 全量桌面单元测试：44 通过、1 失败。失败为改动前已存在的 `tests/town.test.ts:19`：断言仍要求 URL query token，代码使用 Bearer header；本次未修改该测试或 Town 鉴权。
- 原有 `npm run test:e2e` 在 `tests/electron-smoke.mjs:136` 等待旧导航选择器 `nav [data-view="portal"]` 超时。当前用户 UI 已变更，本次没有为此改动界面或伪称全量 E2E 通过。新增专项端到端测试不依赖该选择器。
- 完整 Windows 交叉构建受本机缺少 Windows C SDK（ring 编译缺少 `assert.h`）阻断。Windows 进程管理、MCP 连接、协议限额、文件 I/O 和配置模块已在隔离检查工程中完成 `x86_64-pc-windows-msvc` 目标类型检查；这不等于完整 Windows 构建或运行验证。
- 新增 `.github/workflows/runtime.yml`，覆盖 macOS ARM64/Intel 和原生 Windows 的 Rust、生命周期、私有状态及包测试。当前未推送，CI 未触发；Windows 运行结果仍待实际 runner 验证。

## 交付与剩余验收

本地构建目录：`out/Beings-darwin-arm64/Beings.app`；运行行为和维护说明见 `heart-portal/docs/runtime.md`、`heart-portal/SECURITY.md`。

正式发布前仍需原生 Windows 测试通过，并在两平台验收睡眠唤醒、断网切换、权限撤销、安全软件和签名升级。当前交付是已实现并经过本机验证的代码与开发构建，不宣称 macOS/Windows 所有环境稳定性已获保证。
