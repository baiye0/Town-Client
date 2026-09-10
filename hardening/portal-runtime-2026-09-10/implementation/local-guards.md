# Implementation Plan: 单进程 Portal 补强

## Selected Design And Constraints

用户已授权实现精简设计。保留 Rust 核心与现有守护，不新增数据库、常驻服务或权限平台。

## Source Revision And Drift Check

Portal 起点 `2dab52fc081d80a7bda9ce7735ab50c6cc6726ac`，工作树干净，分支 `codex/portal-runtime-minimal`。设计证据集合 `ce4acda44fa727c9c742a44bbe6bd162eb4c4e663846541dcaf8c91debc9995b`。外层桌面项目已有用户修改且继续变化；仅在涉及 Portal 的文件中做增量修改。

## Affected Components

执行与进程管理、MCP/relay、kit 锁、工具入口、网络工具、状态、Windows 本地升级验证、桌面 Portal 观察与测试。

## Ordered Work Packages

- 共用子进程生命周期、有界输出和原子并发名额。
- 有界协议读取/写入、连接请求并发、kit 冷启动独立锁。
- 工具开关与保留名称统一检查、明确执行信任边界。
- 结构化状态贯通 macOS/Windows 与桌面观察。
- 更新候选执行前验证及真实故障回归。

## Compatibility And Migration

保留工具名称/协议和现有用户配置；执行结果未知不自动重试。正式后台安装所有权不由桌面观察器接管。未提供 Windows 发布证书，不能声称已完成正式签名发布。

## Tactical Protections During Migration

保留已有签名校验、ACL、单实例、升级事务、kit 自恢复与日志脱敏。

## Tests And Security Validation

执行现有 Rust/TypeScript 测试；新增针对取消、输出、过载、插件绕过和陈旧状态的回归。Windows 使用交叉编译检查及平台条件测试；实机执行能力如不可用需明确报告。

## Performance And Resource Benchmarks

测试流式输出上限、并发名额和请求帧上限，不制造未经测量的可用率指标。

## Rollout And Rollback

本地代码改动可审阅，不部署、推送或重启用户服务；配置和用户已有修改保留。

## Acceptance Criteria

共用执行清理路径；有限缓冲；禁用工具不能被插件覆盖；结构化状态不依赖命令输出；验证前不执行 Windows 更新候选；现有测试与新增针对性测试通过。

## Open Decisions

跨重启任务恢复、注销后运行、不可信代码托管留在当前范围之外。
