# Evidence context: Portal 稳定运行架构

日期：2026-09-10。输入类型：源码集合；非完整安全扫描，无 scan manifest 或已验证漏洞清单。

本地仓库：`/Users/d5/Desktop/code/loom-local`
Portal revision：`2dab52fc081d80a7bda9ce7735ab50c6cc6726ac`
外层 revision：`5d347107326fd754fafea1c1dc373a42986ff49f`
Portal 工作树检查干净；外层存在用户修改。分析使用实际文件内容，下表 SHA-256 固定输入身份，不将外层内容等同于 HEAD。
Collection SHA-256：`ce4acda44fa727c9c742a44bbe6bd162eb4c4e663846541dcaf8c91debc9995b`
Artifact count：29
摘要算法：对 hardening.json 的 evidenceInventory 按 sort_keys=True、ensure_ascii=False、separators=(comma,colon) 序列化为 UTF-8，再计算 SHA-256。

## Source inventory

| Evidence | Path | SHA-256 |
| --- | --- | --- |
| E01 — 连接和请求耦合 | `heart-portal/portal/src/relay_client.rs` | `00fdbc5b15fe8da8ac699a093f448ec1331d32d1340d482db8c87023048d21fd` |
| E01 — 连接和请求耦合 | `heart-portal/portal/src/main.rs` | `a69ffdb6c9a1454707cc694858f613b5fa19dda1e467e356f3f1d25db616eb92` |
| E02 — 同步执行生命周期 | `heart-portal/portal/src/tools/exec.rs` | `2d8ddb6c2635d93d4d38c1f864fefb803a882470eac69a7a14ebc19ab85fd9e2` |
| E02 — 同步执行生命周期 | `heart-portal/portal/src/exec_policy.rs` | `9f0b6ff7669ad8354a3eccb5bb89d5a1537e2cf24c61ddda68ac9dfe6fdd12cc` |
| E03 — 内存任务及回调 | `heart-portal/portal/src/process_manager.rs` | `a3e2016bc26806ce9632726a03a3f0c5a52052b851a53fa98c29baa7f5d1f54e` |
| E04 — 当前用户执行边界 | `heart-portal/portal.example.toml` | `60714de1b94d433bda8b88d2ca799fc062c2f84b5490be9fe5039ba86f7fdf41` |
| E04 — 当前用户执行边界 | `heart-portal/portal/src/tools/custom.rs` | `3545530fe496c9e31a100815e9ed174219f98186268aa8dc5361f02d1131701d` |
| E04 — 当前用户执行边界 | `heart-portal/portal/src/tools/mod.rs` | `7b9947c108979c96c0f780e94b18f6ced94b7240933e7d08bea4407c3d4bf715` |
| E05 — 文件与网络工具边界 | `heart-portal/portal/src/tools/file.rs` | `3dbda13b785e389a33cb3556a89782f9f0bbd770a61fc40220f8de9cb55dd0d1` |
| E05 — 文件与网络工具边界 | `heart-portal/portal/src/tools/web.rs` | `bee1daec622552806e1fdf0daf4af4408b5ac5396b96bdf52234ac6d7ca079f3` |
| E06 — 守护与实例所有权 | `heart-portal/portal/src/single_instance.rs` | `5ff196d2797a8ad7b7a8f3b7c5469cc98dde5c16d089b39f40b44ee59eceff35` |
| E06 — 守护与实例所有权 | `heart-portal/portal/src/macos_supervisor.rs` | `aaa9bb03bfabdf3448a663dc3d1daec428c741802261bf317abdeb74b5bf9045` |
| E06 — 守护与实例所有权 | `heart-portal/scripts/install-portal-task.ps1` | `90997b66ccbe53b9c69cead2c96e822cd82cfd9c5ac1cb05586fd6f3518b2540` |
| E06 — 守护与实例所有权 | `desktop/portal.ts` | `93164772d00c037db3319048d34f9ee4a67fc9bcb98ae015df18bfca8c9176c2` |
| E06 — 守护与实例所有权 | `desktop/external-portal.ts` | `ad5eff18cb6c73a58f9cdecbb6bd669f5a574e20891c3772a06de7b5c1b410b8` |
| E07 — 升级信任及恢复 | `heart-portal/portal/src/upgrade.rs` | `02261785a3e1795a2daabb8bc72ca2627f6aa136f28a089caa89f5b9588ba146` |
| E07 — 升级信任及恢复 | `heart-portal/portal/src/windows_upgrade.rs` | `358569cba537d43dc400791b10cf474e47b2e86680463785245a7f1b6787a049` |
| E07 — 升级信任及恢复 | `heart-portal/portal/src/macos_upgrade.rs` | `44e61af2f3cffbcc98930c0bcbf52d83dfa463cad3c396e9dd9501c2f700c2e1` |
| E07 — 升级信任及恢复 | `heart-portal/scripts/portal-macos-upgrade.py` | `da4482c1b1dd762e0a405aee2f097fe4b4d07c3db92d40dca9dec833574c9b9f` |
| E07 — 升级信任及恢复 | `heart-portal/scripts/portal-lifecycle.ps1` | `e1b1a5126cb545081e243bd9080b27085fd985da2a035cbefe6c8ea9dc40f21a` |
| E07 — 升级信任及恢复 | `heart-portal/portal/src/windows_private.rs` | `2e83aadb60c979d85cd42f8c1ba17986dc993c4d001e5ef3229b3e8986c4df13` |
| E08 — 状态与权限 | `heart-portal/portal/src/connection_status.rs` | `9e9e7eb288aecaeb7572302f5b777fd680bc90425795b0ddaf8437f717481b9f` |
| E08 — 状态与权限 | `heart-portal/portal/src/tools/permissions.rs` | `35be4e8f108c4f8c07a9b531a73cf79553c3138f06386a92b211d5fdcdd5cd2b` |
| E09 — kit 自恢复 | `heart-portal/portal/src/kits/manager.rs` | `5f0e7bf1cd19970da65fb916a773210b5b4dc17dc201a860b26bd06bfb607102` |
| E09 — kit 自恢复 | `heart-portal/portal/src/mcp/connection.rs` | `0d4d44d804a5018579469f47d0877b960cd103ea72a798f708ba074973c6eb96` |
| E10 — 验证覆盖与文档 | `heart-portal/.github/workflows/test.yml` | `8895d0b89f4b703bc6c49aa95b32d2ac541a364234586e66fbe875ea3bad4f53` |
| E10 — 验证覆盖与文档 | `heart-portal/SECURITY.md` | `1eac3ccab726949473e4a321c2fa8df4cf4624ba6bc926d6c77aaa605062ea54` |
| E10 — 验证覆盖与文档 | `heart-portal/README.md` | `20bbda706f0d02e19c7078a0edd8ae2c8b538905e57af8ed21f72f186aeb32d5` |
| E10 — 验证覆盖与文档 | `heart-portal/Cargo.lock` | `a184e276b65a8fb20b09e6819b3744de7729311a6284b1c8b1512fb9745e32e4` |

## External primary references

以下为官方参考网页；用于机制类比，不属于上述源码集合摘要。查询日期 2026-09-10；没有保存网页快照或声称网页内容不可变。

- [官方资料 1](https://tailscale.com/docs/concepts/node-keys)
- [官方资料 2](https://goteleport.com/docs/reference/architecture/)
- [官方资料 3](https://docs.github.com/en/actions/reference/security/secure-use)
- [官方资料 4](https://rustdesk.com/docs/en/client/mac/)
- [官方资料 5](https://developer.apple.com/documentation/servicemanagement/smappservice)
- [官方资料 6](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)
- [官方资料 7](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [官方资料 8](https://sparkle-project.org/documentation/)
- [官方资料 9](https://docs.rs/tokio/latest/tokio/process/struct.Command.html)

## Limits

未检查生产 Heart/relay 源码和部署；未读取真实凭证或生产日志；没有运行故障复现、OS 服务安装或跨平台测试。
补充检查了本机 Cargo cache 中 tokio 1.52.3 的 process/mod.rs（Dropping/Cancellation 与 kill_on_drop 文档），与 Cargo.lock 一致；该第三方缓存未计入仓库输入摘要。
本次只新增派生设计文档，未修改运行代码。所有恢复时间、资源预算和可用率都是建议验证目标。
