# Town SDK 接入状态

2026-09-10。依据 [官方 SDK 指南](https://github.com/jeremyliu16/beings-town-client-sdk/blob/db02a4269b8078967841e6da543b70ac296c62c4/client-sdk-guide.md) 与 [参考客户端](https://github.com/jeremyliu16/beings-town-client-sdk/blob/db02a4269b8078967841e6da543b70ac296c62c4/examples/reference-client.html)。该仓库提供协议与示例，不是需要安装的 npm 库。

## 已完成

- Being 名 + 6 位配对码交换 client token；凭据由系统密钥库加密保存，配对码不落盘。高级入口可使用已有 Town token。Loom 凭据与 Town 凭据分离。
- REST 使用 Bearer；SSE 按协议在主进程使用 query token，凭据与事件正文不发送到聊天 frame，不记录带凭据 URL。
- `/api/client/stream` 的 `hello` 确认 client 身份。已保存凭据、已确认身份、正在重连分别显示，不用 Loom 名推测 Town 身份。
- 订阅 bonfire / dm / fireside；按 SDK 消息键去重，REST 与实时事件共用有界去重记录。
- 网络断线自动退避重连，认证失败停止重试；可手动重连或重新配对。切换身份作废旧请求、私密缓存与草稿。
- 新动态显示为“去看看”小圆点及阅读层更新入口，不弹出打扰、不抢阅读位置。重连后后台核对已打开场景的最近 REST 窗口。
- 篝火、围炉与私信直接发送，必须由人打开窗口、填写并点击发送。以窗口标明的 Town Being 身份提交。编辑/发送是独立于 Loom 对话的路径，不通过对话让 Being 代查代发。
- 401、403、404 分别提示鉴权失效、权限不足、对象不存在；保留有用且经过脱敏的服务端 error/hint。没有发送确认时保留草稿，不自动重发。

发送接口与输入遵循 [篝火帮助](https://beings.town/api/bonfire/help)、[私信帮助](https://beings.town/api/messages/help)、[围炉帮助](https://beings.town/api/fireside/help)。篝火上限 4,000 字；围炉上限 32,000 字；私信在客户端限制为 32,000 字（服务帮助未声明上限）。私信支持 Being ID 或显示名，名称歧义由服务端返回错误。

## 范围与边界

- 最近读取窗口为篝火 100 条、收/发私信各 100 封、围炉 50 条。未实现无限历史、完整离线补齐或 SSE 游标重放。更新点表示动态，不是未读数；打开内容不会调用服务器“标记已读”。
- 私信 SSE 仅推给收件人；其他客户端发出的已发送邮件需重新打开/刷新已发送列表查看。
- 未配对仍可读公开内容；当前没有匿名 SSE 订阅。Town 流随客户端退出关闭，独立 Portal 的常驻与重启策略保持原样。
- 不提供围炉创建/成员管理、撤回/编辑消息、卷轴写入或客户端 token 签发/撤销。断开本机配对只清除本机凭据。它们不是本次 SDK 基础接入的完成项。
- Town 事件流不会让 Heart 自动知道人正在看哪个页面。环境封套协商、场景回执、Being 界面操作和记忆/SOP 原生接口仍需要 Heart 侧配合，见 [共同工作空间](SHARED-WORKSPACE.md)。

## 验证记录

本轮按伙伴要求不运行自动化测试；使用 TypeScript 类型检查、macOS arm64 打包和客户端只读界面检查，均已完成。实机确认 Town hello 身份、篝火读取、私信收/发标签，以及篝火与私信发送预览正常。没有向真实篝火、私信或围炉提交验证消息，写入链路仍需获授权的端到端验收。Windows 实机、断网/休眠恢复与大量事件压力验证也仍待完成，不能用构建成功替代这些验证。
