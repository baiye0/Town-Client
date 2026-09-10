# Portal runtime

The runtime stays one Rust process plus the existing platform supervisor. No new
daemon, database or task broker is required. MCP tool names and wire responses
remain compatible; concurrent responses are correlated by JSON-RPC request ID.

| Responsibility | Implementation |
| --- | --- |
| Process lifetime, output collection | `src/child_process.rs`, `src/process_manager.rs` |
| Framing, deadlines, bounded request dispatch | `src/io_limits.rs`, `src/main.rs` |
| Relay reconnect and heartbeat | `src/relay_client.rs` |
| Tool policy before dispatch | `src/tools/mod.rs` |
| Per-kit startup and recovery | `src/kits/manager.rs` |
| Observational status | `src/connection_status.rs` |
| User-session supervision and transactional upgrades | Existing platform modules and scripts |

A dropped connection cancels its synchronous calls and closes their children.
Explicit background commands remain queryable while that Portal instance lives.
No command is replayed. Missing results after a restart are unknown, not failed.
A process reaching its exit status is cleaned before its result is exposed.

| Resource | Bound |
| --- | --- |
| TCP clients | 16 |
| Tool/metadata requests across connections | 16, plus 4 control requests |
| Concurrent shell commands, sync + background | 10 |
| JSON-RPC / WS frame and message | 16 MiB |
| Local authentication | 4 KiB, 10 seconds total |
| Protocol writes | 10 seconds, including the shared WS/MCP write lock |
| Sync shell output retained | Approximately 100 KB returned; pipes continuously drained |
| Background output retained | 1 MiB per session; bounded recent history |
| File / image read | Configured limit capped at 10 MiB |
| Directory listing | 1,000 entries, with truncation flag |
| Public web response | Default 50 KB; maximum 1 MB; 5 redirects; 15 seconds total |
| Callback deliveries | 4 concurrent; existing finite retries, poll as fallback |

Control capacity serves ping and process list/log/kill while long calls occupy
regular slots. Overload is rejected before dispatch rather than queued indefinitely.
Kit initialization uses a per-kit mutex; no global registry lock spans process
startup or RPC. MCP responses and diagnostics cannot allocate unbounded lines.

`heart-portal status --json` reports the latest sample and freshness. Supervised
launches publish a nonce-bound status file. A fresh sample is still not an OS
liveness proof: the desktop combines it with the process it owns or observes.
Standalone launches without a supervisor status target may report unknown.

For local TCP, configure `portal_mcp_token` or `PORTAL_MCP_TOKEN` before starting.
Relay-only users do not need a local TCP token. New installations explicitly opt
in to executable capabilities; existing configs are retained. See [SECURITY.md](../SECURITY.md)
for the actual trust boundary and Windows update provenance requirements.

## Checks

Run `cargo test --locked` and `cargo build --locked`. The runtime workflow runs on
Apple Silicon macOS, Intel macOS and Windows. macOS also runs the real temporary
LaunchAgent/relay lifecycle fixture; Windows runs process/job tests and the
existing task/private-state/package fixtures. The release workflow retains the
larger upgrade/recovery suites. Full Windows tests must pass on Windows before a
release can claim support; cross-platform source checking is not a replacement.

Desktop integration tests live in the parent repository: Portal supervision,
background-service ownership and stale/foreign status rejection. Live sleep/wake,
network changes, permission revocation, endpoint protection and signed installer
upgrades need native acceptance testing on the supported OS versions.
