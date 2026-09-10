Town-Client 0.1.4：手动升级时完整停止旧 Portal 和守护

- 手动覆盖安装后，首次启动会找到同一用户、同一 Being 连接下的旧客户端服务和独立 Portal，保存实际配置、环境和工作目录。
- 先停止旧服务，再对独立安装执行 `stop`，确认引擎及守护均已退出，然后切换并自动启动。成功后只保留一个受客户端管理的运行实例。
- 配置、凭据、Kits 保留；失败恢复旧服务及独立守护。已有更高版本的 Portal 会保留该引擎，同时更新守护程序。
- 修复 Windows 手动升级时未接管独立守护的问题。

安装：先结束本机任务并保存草稿，退出旧客户端，替换 macOS 应用或运行 Windows Setup，然后打开新版。升级会中断正在运行的本机命令，不会自动重放。保留用户数据和原 Portal 配置目录。

安装包内置 Portal 0.8.1；提供 macOS ARM64 和 Windows x64。本版尚未配置 macOS Developer ID、公证及 Windows Authenticode。请从本仓库下载并核对 SHA256SUMS.txt。
