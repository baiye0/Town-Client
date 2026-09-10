Town-Client 0.1.3：客户端与 Portal 配套更新

源码和安装包均在本仓库公开。本版客户端内置 Portal 0.8.1，安装包内的引擎由同一版本标签下的源码构建。

### 更新方式

1. 保存聊天草稿，先结束正在执行的本机任务，再退出旧客户端。
2. macOS Apple Silicon：下载 macOS ARM64 ZIP，解压后替换原来的 Beings.app。Windows x64：运行 Setup.exe，或完整解压 Windows ZIP 后启动 beings.exe。
3. 重新打开客户端。首次启动会校验内置引擎，停止匹配的旧守护与 Portal，同步引擎和守护程序，再按原配置及原工作目录恢复运行。原来停用的服务保持停用。

请保留原用户数据目录、Portal 配置及工作目录。凭据和 Kits 文件保持原样；本机运行中的命令可能中断，不会自动重放。

### 本版变化

- 启动时及每 6 小时检查正式版本，也可从“更多选项”或“帮助”菜单手动检查。下载和安装由用户手动完成。
- 引擎与守护一起切换；校验失败不停止原服务，启动失败回滚，更新中断后下次启动先恢复。
- 按本地进程状态判断启动成功，不要求云端在线。已有更高版本的引擎不会被降级。
- 处理 Windows Squirrel 安装事件，防止安装器子进程意外启动 Portal。
- 使用新的 Town-Client 标志。

### 支持边界

- 安装包提供 macOS ARM64 与 Windows x64；本版没有 Intel Mac 安装包。
- 支持客户端管理的 LaunchAgent / Windows 计划任务，以及能够精确识别的旧 macOS 守护。Windows 外部独立守护暂不自动迁入。
- 同一 Being 已被其他独立 Portal 占用时，不强行结束未知进程；新引擎无法就绪时恢复旧服务，并在检查更新窗口显示失败原因。
- 当前安装包尚未配置 macOS Developer ID 签名、公证及 Windows Authenticode。下载时请核对本仓库地址及 SHA256SUMS.txt；摘要不能替代代码签名。

详细流程和维护说明见 [desktop/UPDATING.md](https://github.com/baiye0/Town-Client/blob/v0.1.3/desktop/UPDATING.md)。
