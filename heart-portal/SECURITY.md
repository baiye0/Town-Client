# Security and permissions

Portal connects a remote Being to the installing user's machine. It is intended
for a Being you trust. It is not a sandbox for hostile code.

## Connections

Relay mode opens an outbound WSS connection and no local TCP listener. Plain WS
is permitted only for an exact loopback host. Remote callbacks use the same TLS
policy. Expired/rejected relay credentials remain visible as `auth_required`;
network failures use bounded backoff. Commands are not replayed on reconnect.

Local TCP mode binds to `127.0.0.1` by default and requires a nonempty
`portal_mcp_token` in the top level of `portal.toml`, or `PORTAL_MCP_TOKEN`.
Clients must first send `{"jsonrpc":"2.0","id":1,"method":"auth","params":{"token":"..."}}`.
Authentication has a 10-second deadline and a 4 KiB frame limit. Explicit existing
non-loopback bind configurations still work, but TCP itself is not encrypted;
use relay mode for remote access.

Keep connection links out of command-line arguments. Supervisors pass them via
`PORTAL_CONNECT_LINK`. Portal removes its own credentials and supervision/status
environment variables from commands and MCP children. This does not hide secrets
from other code already running as the same OS user.

## Execution is an explicit trust decision

The example configuration, Windows first-run configuration, and startup without
a configuration file disable shell execution, screenshots, kits and custom MCP
servers. Desktop-generated settings follow the user's explicit switches.
Existing configuration files retain their previous defaults and explicit values.
All calls check the applicable tool switch before routing; plugins cannot shadow
reserved built-in tool names.

When `exec=true`, commands run with the Portal user's OS permissions. Working
directory and `exec_allowlist` are convenience controls, not security isolation.
Shells, interpreters and developer tools can read outside the workspace, access
the network and modify user-owned configuration. Do not run Portal as root,
Administrator or LocalSystem.

Enabling kits or `custom_tools_enabled` also permits user-level code execution.
In particular, anyone who can write `workspace/tools/mcp.toml` can define commands
when custom MCP is enabled. Keep the installation, credentials and configuration
outside an untrusted writable workspace. Revoking OS screen/accessibility access
makes the corresponding tools unavailable; Portal does not bypass those prompts.

## File and network tools

File reads, listings, writes, edits and search use directory-relative handles
through `cap-std`; canonical path validation alone is not the protection.
Reads are bounded and require regular files. Writes use atomic replacement,
which avoids truncating an existing hardlink target. Screenshots are captured to
a temporary directory and then published through the same file writer.
This is containment for these built-in interfaces, not for executable kits or
commands. Hardlinks already present in the workspace expose their contents to
reads. Concurrent changes made by other applications can cause edit conflicts;
atomic replacement does not provide multi-writer transactions. A canceled file
operation already handed to the OS may finish; its outcome must be checked.

`portal_web_fetch` accepts public HTTP(S) destinations only. Every redirect is
validated, all resolved addresses must be public, and the validated addresses are
pinned for that request. Environment proxies and automatic redirects are disabled.
Bodies, redirect count and total duration are bounded. Explicit local services
belong in trusted configured integrations, not this public-web endpoint.

## Process cleanup and limits

Commands and stdio MCP children share one owner. Unix children use process groups;
Windows children are created suspended and assigned to a kill-on-close Job Object
before resuming. Timeouts, cancellation and normal leader exit clean the managed
group/job. Deliberate Unix daemonization can escape a process group; this mechanism
is not an OS sandbox. Unexpected OS cleanup failures are reported as unknown.

Protocol frames, writes, concurrent requests, subprocesses, retained output and
callback delivery have bounds. Background tasks may survive a relay reconnect,
but not Portal restart; results and callbacks are not durable. A lost response,
timeout or unknown session does not establish that no side effect occurred.
Never automatically replay a side-effecting command on that basis.

## Status, supervision and updates

Status files contain a PID, launch nonce, boot ID, sequence and timestamp. They are
telemetry only; they never authorize execution, stop or upgrade. Desktop state is
not inferred from command output. Stale/older-binary status is shown as unconfirmed.
One existing supervisor owns each installation; observing a process does not
transfer ownership. The supported default is a logged-in ordinary user session.

macOS retains its existing Developer ID verification and upgrade recovery.
Windows online and local-file updates verify the exact executable bytes against
the latest official release's SHA-256 digest from GitHub HTTPS metadata before
staging or executing a candidate. Local-file updates therefore require network
access and an official newer release. An unpublished community build is rejected
by this update path; build and install it explicitly as a developer instead.
This trusts the official repository/release infrastructure. It is not Authenticode
publisher verification. Windows signing and Windows native release acceptance
remain required deployment work, not guarantees supplied by this source change.
