# 客户端与 Portal 配套更新

## 用户操作

菜单“检查更新”读取正式发布版本；客户端启动及每 6 小时检查一次，有更新时菜单显示目标版本。发布信息读取失败不会阻断聊天或 Portal。点击“打开发布页”后手动下载安装包。

先结束本机任务并保存聊天草稿，退出旧客户端，再替换 macOS 应用、运行 Windows Setup 或完整解压新版 ZIP。保持同一用户数据目录；不要覆盖或删除用户配置目录。重新打开后，客户端会自动同步内置 Portal 和守护程序，更新期间本机连接短暂中断，运行中的命令可能被终止，不会重放。

## 升级事务

1. 验证安装包内 `runtime-bundle.json` 的平台、架构及引擎 SHA-256；比较原引擎版本，拒绝隐式降级。
2. 在独立运行目录暂存引擎、当前守护脚本及版本清单；原配置文件、工作目录、Kits 和配置内的路径保持原位置。复制原加密凭据或私有凭据文件，不经网页传递。
3. 在停止前写入私有恢复日志，记录旧服务及启用状态。
4. 先停用自动重启并卸载旧服务，再停止其管理的 Portal。macOS 等待 launchd 服务退出；Windows 停用计划任务、停止任务并按已验证的可执行路径清理子进程树。
5. 重新登记当前守护，按原配置及原工作目录启动新引擎。校验新进程、nonce、boot ID 和本地状态连续稳定；不以云端在线作为安装成功条件。
6. 成功后记录版本并清除事务日志，保留旧运行目录。失败先停新服务再恢复旧登记；升级中途退出，下次启动先恢复，不立即循环重试。

原来停用的服务保持停用。版本清单 ID 同时覆盖客户端版本、引擎摘要和守护代码，避免同一路径下的引擎或脚本更新被忽略。已管理的服务即使未勾选自动启动，也会同步文件并保留其原运行状态。

支持客户端创建的 macOS LaunchAgent / Windows 计划任务，以及已精确识别的旧版 macOS Portal LaunchAgent。匹配配置目录、连接和名称的 macOS inherited-session 守护可迁入会话级 LaunchAgent，不额外开启登录自启。无法确认身份或管理协议的独立进程不做批量终止，更新状态会说明跳过原因。Windows 外部独立 supervisor 的自动迁入暂不支持；已由客户端管理的 Windows 服务支持配套升级。

这里只升级引擎与其守护；不自动升级第三方 Kits、npm/Python、系统组件或改写 Portal 配置。恢复日志用于 Portal 恢复，不替代客户端安装包回退。当前没有破坏性配置迁移；未来新增不兼容配置需单独设计迁移及回退。

## 发布维护

- `npm version X.Y.Z --no-git-tag-version` 同步客户端与 lockfile 版本。
- `npm run build:portal` 构建配套源码；`npm run make` 打包时从实际二进制读取版本、计算摘要并生成清单。不要复用未知来源或不对应源码的二进制。
- `.github/workflows/release.yml` 手动触发时只测试和构建，用于发版前验证。确认后推送版本 tag：两个平台构建和 Windows 原生升级测试通过、包内引擎摘要核对后，先创建草稿并上传全部安装包、清单及摘要，最后公开为正式 Release。上传失败保留草稿。
- 更新 `desktop/RELEASE_NOTES.md` 后再创建版本 tag；草稿和预发布不会提示用户更新。该首版不提供 Intel Mac 安装包。
- 默认更新源为 `baiye0/Town-Client`。私有仓库无法匿名检测：应在构建时设置 `TOWN_UPDATE_REPOSITORY=owner/public-release-repo`（Actions 中使用同名 repository variable），只公开版本及二进制；不内置 GitHub token。保持私有时可在浏览器登录发布页下载。
- 客户端手动安装，未使用自动下载/替换应用。macOS Developer ID、公证及 Windows Authenticode 仍需正式发布配置；SHA-256 检查只能校验包内一致性，不能代替签名和来源信任。

## 验证

`npm test` 包含更新检查、配套切换、损坏包拒绝、停止状态保留、失败回滚、中断恢复及 Squirrel 安装事件测试。

`TOWN_NATIVE_UPGRADE_TESTS=1 npx vitest run tests/runtime-update-native.test.ts` 在 macOS 上使用隔离 profile 和真实 LaunchAgent，验证离线升级及坏引擎回滚。Windows PowerShell 中先设置 `$env:TOWN_NATIVE_UPGRADE_TESTS='1'`，同一测试验证计划任务路径；需要可用的交互式用户会话。该测试不触碰日常 Portal。Windows 实机结果应单独记录，不能用 mock 通过代替。
