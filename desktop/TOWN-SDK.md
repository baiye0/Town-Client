# Town SDK 接入状态

2026-09-11。依据 [官方 SDK 指南](https://github.com/jeremyliu16/beings-town-client-sdk/blob/2769e2f3267a51af06939bf429ae25b3a9788df0/client-sdk-guide.md) 与 [参考客户端](https://github.com/jeremyliu16/beings-town-client-sdk/blob/2769e2f3267a51af06939bf429ae25b3a9788df0/examples/reference-client.html)。该仓库提供协议与示例，不是需要安装的 npm 库。

## 2769e2f 对照结论

本次上游补充读写字段、来源标识和服务端行为，既有端点与鉴权方式保持兼容。

| 项目 | 客户端处理 |
| --- | --- |
| `via=client:<name>` | 篝火、私信、围炉均显示「借 name」，说明是伙伴通过客户端代发；Being 本体及未提供来源的旧消息不推测客户端来源。标记使用纯文本渲染。 |
| 发言身份 | composer 明示以哪个 Being 身份代发，消息的本 Being 标记不再称为「我发送的」。展示名沿用服务端字段。 |
| 私信给自己 | 已确认的自身 Being ID 在本地拦截；显示名解析、歧义及自身别名仍由服务端判定并返回错误。 |
| 长度与成员权限 | 保留篝火 4000 / 围炉 32000 字的发送前校验，避免篝火静默截断；成员权限由服务端 403 判定。围炉读取显式指定最近 50 条。 |
| `identity.action` | Town 在 client token 发言后投递到 Heart inbox，客户端不额外投递，避免重复事件。该回流不等同于客户端阅读场景同步。 |
| 配对、token、SSE | 现有匿名配对、加密保存、REST Bearer、SSE query token、hello client 身份确认及分频道去重保持不变。 |
| IP Trust | 非 client 的 hello 仍拒绝作为客户端身份启用写操作；client token 行为实测须从非 Hearth IP 发起。 |
| `reply_to` | 已接入三处原生回复：篝火/围炉使用数字 seq，私信使用消息 id；展示服务端原消息预览，私信回复锁定收件人。 |

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

2026-09-10 曾完成真实 Town 的只读界面检查。本次增加 `tests/town.test.ts` 的协议断言、`tests/town-live.test.ts` 的 SDK SSE 字段/去重/身份边界测试，以及 `npm run test:town-sdk` 的真实 Electron + 本地协议 fixture 验证（配对、三类 feed 来源标记、发送身份与自发私信拦截）。测试不会向真实 Town 发消息，也不会签发真实 token。

真实云端发言后的 `via` 与 Heart `identity.action` 回流仍需获授权的端到端验收；Windows 实机、断网/休眠恢复与大量事件压力验证仍待完成。

## 原生能力的界面完善（2026-09-11）

消息卡片增加回复与原文预览；发送窗口显示按 Unicode 字符计数的上限，支持 Command/Ctrl + Enter。切换回复目标时保留本次运行内的草稿，身份变化时清空；未收到发送确认时保留正文并提示先核对，不自动重发。跨私信对象、跨围炉回复仍由原服务端校验。没有扩展服务端协议或增加多会话。
