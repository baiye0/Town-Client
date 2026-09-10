use crate::child_process::ChildProcess;
use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWrite, BufReader, BufWriter};
use tokio::sync::{oneshot, Mutex};
use tracing::{debug, error, warn};

use super::protocol::{JsonRpcRequest, JsonRpcResponse, McpToolInfo};

/// Default timeout for MCP handshake and metadata requests (initialize, tools/list).
const DEFAULT_RPC_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout for tool calls — tools may run for minutes (code review, web fetch, etc.).
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(600);

/// Configuration for a stdio MCP server process.
#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub name: String,
    pub command: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: Option<PathBuf>,
}

/// A stdio JSON-RPC connection to a single MCP server.
pub struct McpConnection {
    child_task: Option<tokio::task::JoinHandle<Result<()>>>,
    stop: tokio::sync::watch::Sender<bool>,
    reader_task: Option<tokio::task::JoinHandle<()>>,
    stderr_task: Option<tokio::task::JoinHandle<()>>,
    writer: Arc<Mutex<BufWriter<Box<dyn AsyncWrite + Send + Unpin>>>>,
    responses: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
    next_id: AtomicU64,
    config: McpServerConfig,
    alive: Arc<AtomicBool>,
}

impl McpConnection {
    /// Spawn and initialize a stdio MCP server.
    pub async fn spawn(config: McpServerConfig) -> Result<Self> {
        if config.command.is_empty() {
            anyhow::bail!("Empty command for MCP server '{}'", config.name);
        }

        let mut command = tokio::process::Command::new(&config.command[0]);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        command
            .args(&config.command[1..])
            .envs(&config.env)
            .env_remove("HEART_PORTAL_SUPERVISED")
            .env_remove("PORTAL_CONNECT_LINK")
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Some(cwd) = &config.cwd {
            command.current_dir(cwd);
        }

        let mut child = ChildProcess::spawn(&mut command).with_context(|| {
            format!(
                "Failed to spawn MCP server '{}' with command: {:?}",
                config.name, config.command
            )
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            anyhow::anyhow!("Failed to get stdin for MCP server '{}'", config.name)
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            anyhow::anyhow!("Failed to get stdout for MCP server '{}'", config.name)
        })?;

        let stderr = child.stderr.take();

        let responses = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let (stop, mut stopped) = tokio::sync::watch::channel(false);
        let reader_done = Arc::new(tokio::sync::Notify::new());
        let process_reader_done = reader_done.clone();
        let process_alive = alive.clone();
        let process_responses = responses.clone();
        let process_name = config.name.clone();
        let child_task = tokio::spawn(async move {
            let result = tokio::select! {
                biased;
                _ = stopped.changed() => child.terminate().await.map(|_| ()),
                result = child.wait() => result.map(|_| ()).map_err(anyhow::Error::from),
            };
            process_alive.store(false, Ordering::SeqCst);
            // Let the reader deliver buffered final responses before failing
            // anything left over. Escaped pipe holders cannot delay this forever.
            let _ =
                tokio::time::timeout(Duration::from_secs(2), process_reader_done.notified()).await;
            Self::drop_pending(process_responses, &process_name).await;
            result
        });
        let reader_stop = stop.clone();
        let mut connection = Self {
            child_task: Some(child_task),
            stop,
            reader_task: None,
            stderr_task: None,
            writer: Arc::new(Mutex::new(BufWriter::new(Box::new(stdin)))),
            responses: responses.clone(),
            next_id: AtomicU64::new(1),
            config,
            alive: alive.clone(),
        };

        let server_name = connection.config.name.clone();
        connection.reader_task = Some(tokio::spawn(async move {
            if let Err(e) =
                Self::reader_task(BufReader::new(stdout), responses, alive, &server_name).await
            {
                error!("MCP server '{}' reader failed: {}", server_name, e);
            }
            let _ = reader_stop.send(true);
            reader_done.notify_one();
        }));

        if let Some(stderr) = stderr {
            let server_name = connection.config.name.clone();
            connection.stderr_task = Some(tokio::spawn(async move {
                let mut reader = stderr;
                let mut bytes = [0u8; 4096];
                // Bound diagnostics even when a child never writes a newline.
                // Do not copy arbitrary child output (which may contain secrets)
                // into persistent Portal logs.
                loop {
                    match reader.read(&mut bytes).await {
                        Ok(0) => break,
                        Ok(n) => debug!("MCP server '{}' stderr: {} bytes", server_name, n),
                        Err(err) => {
                            warn!("MCP server '{}' stderr read failed: {}", server_name, err);
                            break;
                        }
                    }
                }
            }));
        }

        if let Err(e) = connection.initialize().await {
            let mut connection = connection;
            let _ = connection.shutdown().await;
            return Err(e);
        }

        debug!(
            "MCP server '{}' spawned and initialized",
            connection.config.name
        );
        Ok(connection)
    }

    async fn reader_task<R>(
        reader: BufReader<R>,
        responses: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
        alive: Arc<AtomicBool>,
        server_name: &str,
    ) -> Result<()>
    where
        R: tokio::io::AsyncRead + Unpin,
    {
        let result = Self::read_responses(reader, responses.clone(), server_name).await;
        // Mark dead before waking callers, on both EOF and read errors. Otherwise
        // a broken pipe/invalid UTF-8 can leave tool calls waiting for ten minutes.
        alive.store(false, Ordering::SeqCst);
        Self::drop_pending(responses, server_name).await;
        result
    }

    async fn read_responses<R>(
        mut reader: BufReader<R>,
        responses: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
        server_name: &str,
    ) -> Result<()>
    where
        R: tokio::io::AsyncRead + Unpin,
    {
        let mut partial = Vec::new();

        loop {
            let frame = crate::io_limits::read_frame(
                &mut reader,
                &mut partial,
                crate::io_limits::MAX_FRAME_BYTES,
            )
            .await?;
            let Some(line) = frame else {
                debug!("MCP server '{}' connection closed", server_name);
                break;
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            debug!("MCP server '{}' response received", server_name);

            let response: JsonRpcResponse = match serde_json::from_str(trimmed) {
                Ok(resp) => resp,
                Err(e) => {
                    warn!("MCP server '{}' sent invalid JSON: {}", server_name, e);
                    continue;
                }
            };

            if let Some(id) = response.id {
                let mut pending = responses.lock().await;
                if let Some(sender) = pending.remove(&id) {
                    if sender.send(response).is_err() {
                        warn!(
                            "MCP server '{}' response receiver dropped for id {}",
                            server_name, id
                        );
                    }
                } else {
                    warn!(
                        "MCP server '{}' sent response for unknown id {}",
                        server_name, id
                    );
                }
            } else {
                debug!("MCP server '{}' sent notification", server_name);
            }
        }

        Ok(())
    }

    async fn drop_pending(
        responses: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
        server_name: &str,
    ) {
        let mut pending = responses.lock().await;
        if !pending.is_empty() {
            warn!(
                "MCP server '{}' reader closed: dropping {} pending response(s)",
                server_name,
                pending.len()
            );
        }
        pending.clear();
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let request = JsonRpcRequest::new(method, params, &self.next_id);
        let request_id = request
            .id
            .ok_or_else(|| anyhow::anyhow!("MCP request missing id"))?;
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.responses.lock().await;
            // Check under the same lock used by reader cleanup: either this
            // request is rejected, or cleanup will see and cancel it.
            if !self.is_alive() {
                anyhow::bail!(
                    "MCP server '{}': the kit process exited or closed stdout",
                    self.config.name
                );
            }
            pending.retain(|_, sender| !sender.is_closed());
            anyhow::ensure!(pending.len() < 32, "MCP request limit reached");
            pending.insert(request_id, tx);
        }

        let request_json = serde_json::to_string(&request).with_context(|| {
            format!("Serializing request for MCP server '{}'", self.config.name)
        })?;

        debug!("MCP server '{}' request: {}", self.config.name, method);

        let write_result = tokio::time::timeout(crate::io_limits::WRITE_TIMEOUT, async {
            let mut writer = self.writer.lock().await;
            crate::io_limits::write_frame(&mut *writer, &request_json).await
        })
        .await;
        if !matches!(write_result, Ok(Ok(()))) {
            self.responses.lock().await.remove(&request_id);
            self.alive.store(false, Ordering::SeqCst);
            Self::drop_pending(self.responses.clone(), &self.config.name).await;
            anyhow::bail!(
                "MCP write failed or timed out; outcome unknown, do not automatically retry"
            );
        }

        let response = match tokio::time::timeout(timeout, rx).await {
            Ok(result) => result.with_context(|| {
                let state = if self.is_alive() {
                    "response receiver was dropped"
                } else {
                    "the kit process exited or closed stdout"
                };
                format!(
                    "Response channel closed for MCP server '{}': {}",
                    self.config.name, state
                )
            })?,
            Err(_) => {
                // Clean up pending request on timeout
                self.responses.lock().await.remove(&request_id);
                anyhow::bail!(
                    "Timeout ({}s) waiting for MCP server '{}'; outcome unknown, do not automatically retry",
                    timeout.as_secs(),
                    self.config.name
                );
            }
        };

        if let Some(error) = response.error {
            anyhow::bail!(
                "MCP server '{}' returned error: {} (code: {})",
                self.config.name,
                error.message,
                error.code
            );
        }

        response.result.ok_or_else(|| {
            anyhow::anyhow!(
                "MCP server '{}' response missing result field",
                self.config.name
            )
        })
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        self.request_with_timeout(method, params, DEFAULT_RPC_TIMEOUT)
            .await
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        let request = JsonRpcRequest::notification(method, params);
        let request_json = serde_json::to_string(&request).with_context(|| {
            format!(
                "Serializing notification for MCP server '{}'",
                self.config.name
            )
        })?;

        debug!("MCP server '{}' notification: {}", self.config.name, method);

        tokio::time::timeout(crate::io_limits::WRITE_TIMEOUT, async {
            let mut writer = self.writer.lock().await;
            crate::io_limits::write_frame(&mut *writer, &request_json).await
        })
        .await
        .context("MCP notification write timed out")??;

        Ok(())
    }

    async fn initialize(&self) -> Result<()> {
        debug!("Initializing MCP server '{}'", self.config.name);

        let _init_result = self
            .request(
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "clientInfo": {
                        "name": "heart-cortex",
                        "version": "1.0.0"
                    }
                }),
            )
            .await?;

        debug!("MCP server '{}' initialized", self.config.name);

        self.notify("notifications/initialized", serde_json::json!({}))
            .await?;

        debug!("MCP server '{}' initialization complete", self.config.name);
        Ok(())
    }

    /// Get the list of tools from this server.
    pub async fn list_tools(&self) -> Result<Vec<McpToolInfo>> {
        let result = self.request("tools/list", serde_json::json!({})).await?;

        let tools = result["tools"].as_array().ok_or_else(|| {
            anyhow::anyhow!(
                "MCP server '{}' tools/list response missing 'tools' array",
                self.config.name
            )
        })?;

        let mut parsed_tools = Vec::new();
        for tool in tools {
            let tool_info: McpToolInfo =
                serde_json::from_value(tool.clone()).with_context(|| {
                    format!("Parsing tool info from MCP server '{}'", self.config.name)
                })?;
            parsed_tools.push(tool_info);
        }

        debug!(
            "MCP server '{}' provides {} tools",
            self.config.name,
            parsed_tools.len()
        );
        Ok(parsed_tools)
    }

    /// Call a tool on this server.
    pub async fn call_tool(&self, tool_name: &str, arguments: Value) -> Result<Value> {
        debug!(
            "Calling tool '{}' on MCP server '{}'",
            tool_name, self.config.name
        );

        let result = self
            .request_with_timeout(
                "tools/call",
                serde_json::json!({
                    "name": tool_name,
                    "arguments": arguments
                }),
                TOOL_CALL_TIMEOUT,
            )
            .await?;

        debug!(
            "Tool '{}' on MCP server '{}' returned",
            tool_name, self.config.name
        );
        Ok(result)
    }

    /// Check whether the connection reader task is still alive.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Shutdown the child process.
    pub async fn shutdown(&mut self) -> Result<()> {
        debug!("Shutting down MCP server '{}'", self.config.name);

        // Publish the shutdown while holding the response-map lock used by new
        // requests, so none can slip in and wait on a connection being closed.
        {
            let mut pending = self.responses.lock().await;
            self.alive.store(false, Ordering::SeqCst);
            if !pending.is_empty() {
                debug!(
                    "MCP server '{}' shutdown: cancelling {} pending response(s)",
                    self.config.name,
                    pending.len()
                );
            }
            pending.clear();
        }

        // Stop before acquiring stdin: a blocked writer must not block cleanup.
        let _ = self.stop.send(true);
        let cleanup = if let Some(mut task) = self.child_task.take() {
            match tokio::time::timeout(Duration::from_secs(8), &mut task).await {
                Ok(result) => result.context("Joining MCP process owner")?,
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    Err(anyhow::anyhow!(
                        "MCP process cleanup not confirmed; outcome unknown"
                    ))
                }
            }
        } else {
            Ok(())
        };
        // The terminated child releases a blocked writer; bound the lock too.
        let _ = tokio::time::timeout(Duration::from_secs(1), async {
            let mut writer = self.writer.lock().await;
            *writer = BufWriter::new(Box::new(tokio::io::sink()));
        })
        .await;

        // Child processes may still be releasing inherited stdout/stderr handles
        // after their launcher exits. Await the readers so Windows releases the
        // kit's working directory before callers remove or replace it.
        let reader_task = self.reader_task.take();
        let stderr_task = self.stderr_task.take();
        tokio::join!(
            finish_io_task(reader_task, "stdout", &self.config.name),
            finish_io_task(stderr_task, "stderr", &self.config.name),
        );

        cleanup
    }
}

impl Drop for McpConnection {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
        if let Some(task) = self.child_task.take() {
            task.abort();
        }
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}

async fn finish_io_task(
    task: Option<tokio::task::JoinHandle<()>>,
    stream: &str,
    server_name: &str,
) {
    let Some(mut task) = task else {
        return;
    };
    match tokio::time::timeout(Duration::from_secs(2), &mut task).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => warn!(
            "MCP server '{}' {} reader task failed: {}",
            server_name, stream, e
        ),
        Err(_) => {
            warn!(
                "Timeout waiting for MCP server '{}' {} reader task",
                server_name, stream
            );
            task.abort();
            let _ = task.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn request_after_reader_closed_fails_without_waiting_or_writing() {
        let (writer, mut peer) = tokio::io::duplex(4096);
        let connection = McpConnection {
            child_task: None,
            stop: tokio::sync::watch::channel(false).0,
            reader_task: None,
            stderr_task: None,
            writer: Arc::new(Mutex::new(BufWriter::new(Box::new(writer)))),
            responses: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            config: McpServerConfig {
                name: "closed-reader".into(),
                command: vec![],
                env: HashMap::new(),
                cwd: None,
            },
            alive: Arc::new(AtomicBool::new(true)),
        };
        McpConnection::reader_task(
            BufReader::new(&b""[..]),
            connection.responses.clone(),
            connection.alive.clone(),
            "closed-reader",
        )
        .await
        .unwrap();
        // The kit may close stdout while keeping stdin open. A successful write
        // must not make a new request wait for the normal ten-minute timeout.
        let error = tokio::time::timeout(
            Duration::from_secs(1),
            connection.call_tool("example", serde_json::json!({})),
        )
        .await
        .expect("closed reader must fail immediately")
        .unwrap_err();
        assert!(error.to_string().contains("closed stdout"), "{error}");
        assert!(connection.responses.lock().await.is_empty());
        drop(connection);
        let mut output = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut peer, &mut output)
            .await
            .unwrap();
        assert!(output.is_empty(), "must not write to a dead connection");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn cmd_kit_handles_spaces_and_literal_metacharacters() {
        let dir = std::env::temp_dir().join(format!("portal kit ({})", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let script = dir.join("kit shim.cmd");
        std::fs::write(
            &script,
            concat!(
                "@echo off\r\n",
                "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%~dp0server.ps1\" %*\r\n",
            ),
        )
        .unwrap();
        // A real line reader: consecutive `set /p` in cmd can consume multiple
        // pipe lines at once, making a batch-only MCP fixture nondeterministic.
        std::fs::write(
            dir.join("server.ps1"),
            r#"
$ErrorActionPreference = 'Stop'
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = ConvertFrom-Json -InputObject $line
    if ($null -ne $request.id) {
        $result = @{ argument = $args[0] }
        $response = @{ jsonrpc = '2.0'; id = $request.id; result = $result }
        [Console]::WriteLine((ConvertTo-Json -InputObject $response -Compress -Depth 5))
    }
}
"#,
        )
        .unwrap();
        let mut connection = McpConnection::spawn(McpServerConfig {
            name: "cmd-test".into(),
            command: vec![
                script.to_string_lossy().into_owned(),
                "space & value".into(),
            ],
            env: HashMap::new(),
            cwd: Some(dir.clone()),
        })
        .await
        .unwrap();
        let result = connection
            .request_with_timeout("ping", serde_json::json!({}), Duration::from_secs(5))
            .await;
        connection.shutdown().await.unwrap();
        assert_eq!(result.unwrap()["argument"], "space & value");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn closed_reader_drops_pending_on_eof_and_read_error() {
        for input in [&b""[..], &b"\xff\n"[..]] {
            let (sender, receiver) = oneshot::channel();
            let responses = Arc::new(Mutex::new(HashMap::from([(1, sender)])));
            let alive = Arc::new(AtomicBool::new(true));
            let result = McpConnection::reader_task(
                BufReader::new(input),
                responses.clone(),
                alive.clone(),
                "test",
            )
            .await;
            assert_eq!(result.is_err(), !input.is_empty());
            assert!(!alive.load(Ordering::SeqCst));
            assert!(responses.lock().await.is_empty());
            assert!(receiver.await.is_err());
        }
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    // These fixtures run only in subprocesses explicitly launched by the test.
    #[test]
    #[ignore]
    fn orphan_fixture() {
        let Ok(marker) = std::env::var("PORTAL_TEST_ORPHAN_MARKER") else {
            return;
        };
        std::thread::sleep(Duration::from_secs(2));
        std::fs::write(marker, "orphan survived").unwrap();
    }
    #[test]
    #[ignore]
    fn server_fixture() {
        use std::io::{BufRead, Write};
        if std::env::var_os("PORTAL_TEST_ORPHAN_MARKER").is_none() {
            return;
        }
        for line in std::io::stdin().lock().lines() {
            let value: Value = serde_json::from_str(&line.unwrap()).unwrap();
            if value.get("id").is_none() {
                continue;
            }
            let finish = value["method"] == "tools/call";
            if finish {
                let _child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--ignored",
                        "--exact",
                        "mcp::connection::lifecycle_tests::orphan_fixture",
                        "--nocapture",
                    ])
                    .spawn()
                    .unwrap();
            }
            println!(
                "\n{}",
                serde_json::json!({"jsonrpc":"2.0","id":value["id"],"result":
                if finish { serde_json::json!({"content":[{"type":"text","text":"final response"}]}) }
                else { serde_json::json!({"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fixture","version":"1"}}) }})
            );
            std::io::stdout().flush().unwrap();
            if finish {
                std::process::exit(0);
            }
        }
    }
    #[tokio::test]
    async fn mcp_exit_drains_final_reply_and_stops_inherited_children() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("orphan");
        let mut connection = McpConnection::spawn(McpServerConfig {
            name: "lifecycle-fixture".into(),
            command: vec![
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                "--ignored".into(),
                "--exact".into(),
                "mcp::connection::lifecycle_tests::server_fixture".into(),
                "--nocapture".into(),
            ],
            env: HashMap::from([(
                "PORTAL_TEST_ORPHAN_MARKER".into(),
                marker.to_string_lossy().into_owned(),
            )]),
            cwd: Some(temp.path().to_path_buf()),
        })
        .await
        .unwrap();
        let reply = connection
            .call_tool("finish", serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(reply["content"][0]["text"], "final response");
        tokio::time::sleep(Duration::from_millis(2200)).await;
        assert!(
            !marker.exists(),
            "MCP descendant survived the leader's exit"
        );
        assert!(!connection.is_alive());
        connection.shutdown().await.unwrap();
    }
}
