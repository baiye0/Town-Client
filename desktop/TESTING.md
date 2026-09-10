# 自动化测试

## 一条命令运行

克隆仓库并安装依赖后执行 `npm run test:all`。需要已安装的 Rust toolchain，仓库内 `heart-portal/` 源码以及操作系统的桌面会话和可用密钥库。使用 `HEART_PORTAL_SOURCE` 可指定其他引擎源码目录。第一次构建会下载 Electron 和 Rust 依赖。

`npm run test:all -- --reuse-package` 使用已有客户端包，仍会执行 Rust 原生测试及所有适用的 E2E。源码改变后应执行默认命令重新构建，避免测试旧包。`BEINGS_EXECUTABLE` 可指定被测客户端的可执行文件。

## 覆盖与边界

| 测试层 | 自动验证内容 | 命令 |
| --- | --- | --- |
| 类型检查 | 桌面 IPC、设置、渲染器与后台服务的类型契约 | `npm run typecheck` |
| 客户端单元测试 | 凭据隔离、代理路由、流式请求、Portal 守护、配置失败回滚、Town 认证和 Kit 导入边界 | `npm test` |
| Rust 原生测试 | 配置解析、单实例锁、Relay 握手与退避、进程管理、路径边界、命令策略、Kit 工具及重启协议 | 在 Portal 源码目录执行 `cargo test --locked -p heart-portal -- --test-threads=1` |
| 桌面集成 | 实际 Electron 安装包、本地 HTTP/WebSocket 模拟 Being、真实 Rust Portal、附件与 SSE、文件写入、stdio Kit、模型设置、主题、草稿保留、对话刻度索引/搜索、过程区停止按钮和配置重载 | `npm run test:e2e` |
| 原生后台服务 | 实际 macOS LaunchAgent，关闭客户端后工具调用、SIGKILL 恢复、无界面启动登录项、附着和停用持久化 | 已包含在 macOS 桌面集成中 |
| Town 界面 | 模拟 HTTPS 数据通过真实 IPC/代理，验证篝火、收发件箱、认证、正文净化、分页、Kit 参数及实际导入 | `npm run test:town-ui` |

本地模拟 Being 能稳定复现协议及客户端行为，不代表真实云端当前可用，也不测试 LLM 回复质量或真实 Town token 的授权情况。登录项测试通过卸载/重新加载临时注册项模拟启动过程，不会重启或注销电脑。睡眠唤醒和 Windows 计划任务全生命周期仍需目标机器补充验收。Windows 专用 Rust 测试在 Mac 上按引擎声明跳过。

## CI 接入

`.github/workflows/desktop-tests.yml` 在 push、pull request 和手动运行时执行 macOS/Windows 矩阵，构建并运行客户端和引擎测试，通过后执行 `npm run make` 并上传平台分发包。Portal 源码与客户端位于同一仓库，由同一次提交记录，无需跨仓库 checkout 权限。

托管 runner 设置 `BEINGS_TEST_BACKGROUND=0`，报告中显示 **SKIPPED**；普通 Portal 子进程、真实 Relay/工具调用及 Rust 测试仍执行。不能把这个结果当成登录自启验收。

若需要 CI 自动验收真实 macOS 后台服务，准备专用测试 Mac，在已登录图形会话的用户下运行 GitHub runner，并添加 `beings-test` 标签。手动运行 workflow 时勾选 `native_background`，会额外执行原生后台服务 job。不要把未经信任的分支放到日常办公机器上的自托管 runner 执行。该 runner 尚未由本项目自动配置，工作流配置本身不代表云端已经运行成功。

## 报告与隔离

- `test-results/summary.md`：阶段结果、耗时、平台和后台测试是否适用。
- `test-results/summary.json`：适合其他 CI 系统读取的结构化结果；失败退出码为 1。
- `test-results/unit.xml`：客户端单元测试的 JUnit 报告。
- `test-results/*.log`：各阶段原始日志，包含 Rust 实际通过/忽略计数。
- `test-results/*.png`：界面截图，桌面失败时保存 `failure.png`，Town 失败时保存 `town-failure.png`。
- `test-results/town-trace.zip`：通过 `npx playwright show-trace test-results/town-trace.zip` 回放 Town 操作。

测试使用随机临时 profile、独立工作和 Kit 目录、模拟 token、本地随机端口。真实后台测试注册名按临时 profile 生成；正常结束、断言失败以及 SIGINT/SIGTERM 时清理自己的 macOS 登录项，不停止用户原有服务。强制杀死测试进程（SIGKILL）或主机断电无法执行 finally 清理；可按测试临时 profile 对应的 `portal-service.json` 定位残留登录项，不能按通用 Portal 进程名批量终止。
