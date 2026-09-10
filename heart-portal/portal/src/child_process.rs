//! One lifecycle for shell commands and MCP children. This is resource management,
//! not a sandbox: children still run with the installing user's permissions.
use anyhow::{Context, Result};
use std::ops::{Deref, DerefMut};
use std::process::ExitStatus;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

pub(crate) struct ChildProcess {
    child: Child,
    #[cfg(unix)]
    group: Option<i32>,
    #[cfg(windows)]
    job: std::os::windows::io::OwnedHandle,
}

impl ChildProcess {
    pub fn spawn(command: &mut Command) -> Result<Self> {
        command.kill_on_drop(true);
        // Never pass Portal control credentials to a workload.
        for key in [
            "PORTAL_CONNECT_LINK",
            "PORTAL_MCP_TOKEN",
            "HEART_PORTAL_SUPERVISED",
            "HEART_PORTAL_READY_FILE",
            "HEART_PORTAL_READY_NONCE",
            "HEART_PORTAL_MACOS_SUPERVISOR",
            "HEART_PORTAL_STATUS_FILE",
            "HEART_PORTAL_STATUS_NONCE",
        ] {
            command.env_remove(key);
        }
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(0x08000000 | 0x00000004); // NO_WINDOW | SUSPENDED
        let child = command.spawn().context("Starting managed process")?;
        #[cfg(unix)]
        let group = child.id().map(|pid| pid as i32);
        #[cfg(windows)]
        let job = windows::contain_and_resume(&child)?;
        Ok(Self {
            child,
            #[cfg(unix)]
            group,
            #[cfg(windows)]
            job,
        })
    }

    pub async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        #[cfg(unix)]
        if let Some(pid) = self.group {
            // Observe exit without reaping: the group ID cannot be reused until
            // descendants are stopped. Tokio reaps the leader only afterward.
            loop {
                let (rc, exited) = {
                    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
                    let rc = unsafe {
                        libc::waitid(
                            libc::P_PID,
                            pid as libc::id_t,
                            &mut info,
                            libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
                        )
                    };
                    (rc, unsafe { info.si_pid() } != 0)
                };
                if rc < 0 {
                    let error = std::io::Error::last_os_error();
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    if error.raw_os_error() == Some(libc::ECHILD) {
                        self.group = None;
                    }
                    return Err(error);
                }
                if exited {
                    self.kill_tree();
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        }
        let result = self.child.wait().await;
        #[cfg(unix)]
        if result.is_ok() {
            self.group = None;
        }
        #[cfg(windows)]
        if result.is_ok() {
            self.kill_tree();
        }
        result
    }

    pub async fn terminate(&mut self) -> Result<ExitStatus> {
        #[cfg(unix)]
        if let Some(group) = self.group {
            unsafe {
                libc::kill(-group, libc::SIGTERM);
            }
            // Keep the group leader unreaped until the final signal: its ID
            // cannot be reused for an unrelated process group during this grace.
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        self.kill_tree();
        let _ = self.child.start_kill();
        tokio::time::timeout(Duration::from_secs(5), self.wait())
            .await
            .context("Process cleanup timed out; outcome may be unknown")?
            .context("Reaping managed process")
    }

    fn kill_tree(&self) {
        #[cfg(unix)]
        if let Some(group) = self.group {
            unsafe {
                libc::kill(-group, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(
                    self.job.as_raw_handle(),
                    1,
                );
            }
        }
    }
}

impl Deref for ChildProcess {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl DerefMut for ChildProcess {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}
impl Drop for ChildProcess {
    fn drop(&mut self) {
        self.kill_tree();
    }
}

/// Consume pipes continuously but retain only a bounded prefix. Decoder state
/// stays bounded too, including output without line breaks.
pub(crate) async fn capture(
    mut stream: impl AsyncRead + Unpin,
    encoding: crate::tools::text::OutputEncoding,
    limit: usize,
) -> Result<(String, bool)> {
    let mut decoder = crate::tools::text::OutputDecoder::new(encoding);
    let mut bytes = [0; 8192];
    let mut output = String::new();
    let mut truncated = false;
    loop {
        let n = stream.read(&mut bytes).await?;
        let text = decoder.push(&bytes[..n], n == 0);
        if !truncated {
            let prefix = crate::tools::text::byte_prefix(&text, limit.saturating_sub(output.len()));
            truncated = prefix.len() < text.len();
            output.push_str(prefix);
        }
        if n == 0 {
            return Ok((output, truncated));
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        System::{Diagnostics::ToolHelp::*, JobObjects::*, Threading::*},
    };

    pub fn contain_and_resume(child: &Child) -> Result<OwnedHandle> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            anyhow::ensure!(
                !handle.is_null(),
                "CreateJobObject: {}",
                std::io::Error::last_os_error()
            );
            let job = OwnedHandle::from_raw_handle(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            anyhow::ensure!(
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of_val(&limits) as u32
                ) != 0,
                "Setting process job limits: {}",
                std::io::Error::last_os_error()
            );
            anyhow::ensure!(
                AssignProcessToJobObject(
                    handle,
                    child.raw_handle().context("Missing process handle")?
                ) != 0,
                "AssignProcessToJobObject: {}",
                std::io::Error::last_os_error()
            );
            // Tokio exposes the process handle, not the primary thread handle.
            // The process was created suspended, so no workload runs before it
            // belongs to our job. Snapshot finds its still-suspended main thread.
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            anyhow::ensure!(
                snapshot != INVALID_HANDLE_VALUE,
                "Thread snapshot: {}",
                std::io::Error::last_os_error()
            );
            let snapshot = OwnedHandle::from_raw_handle(snapshot);
            let mut entry: THREADENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of_val(&entry) as u32;
            let mut more = Thread32First(snapshot.as_raw_handle(), &mut entry);
            let mut resumed = false;
            while more != 0 {
                if Some(entry.th32OwnerProcessID) == child.id() {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                    anyhow::ensure!(
                        !thread.is_null(),
                        "Opening child thread: {}",
                        std::io::Error::last_os_error()
                    );
                    let thread = OwnedHandle::from_raw_handle(thread);
                    let count = ResumeThread(thread.as_raw_handle());
                    anyhow::ensure!(
                        count != u32::MAX,
                        "Resuming child: {}",
                        std::io::Error::last_os_error()
                    );
                    resumed |= count > 0;
                }
                more = Thread32Next(snapshot.as_raw_handle(), &mut entry);
            }
            anyhow::ensure!(resumed, "Suspended child has no resumable thread");
            Ok(job)
        }
    }
}

#[derive(Debug)]
pub(crate) struct CapturedOutput {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

pub(crate) async fn output(
    command: &mut Command,
    encoding: crate::tools::text::OutputEncoding,
    timeout: Duration,
    limit: usize,
) -> Result<CapturedOutput> {
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = ChildProcess::spawn(command)?;
    let stdout = child.stdout.take().context("Missing stdout")?;
    let stderr = child.stderr.take().context("Missing stderr")?;
    // No detached pipe-reader tasks survive cancellation of the caller.
    let work = async {
        let (status, out, err) = tokio::join!(
            child.wait(),
            capture(stdout, encoding, limit),
            capture(stderr, encoding, limit)
        );
        let (stdout, out_truncated) = out?;
        let (stderr, err_truncated) = err?;
        anyhow::Ok(CapturedOutput {
            status: status?,
            stdout,
            stderr,
            truncated: out_truncated || err_truncated,
        })
    };
    match tokio::time::timeout(timeout, work).await {
        Ok(result) => result,
        Err(_) => {
            child.terminate().await?;
            anyhow::bail!("Command timed out after {}s; process stopped, earlier side effects may remain. Do not automatically retry.", timeout.as_secs())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::text::OutputEncoding;

    #[tokio::test]
    async fn drains_large_output_without_retaining_it_or_splitting_utf8() {
        let bytes = "中🙂".repeat(100_000).into_bytes();
        let (text, truncated) = capture(bytes.as_slice(), OutputEncoding::Utf8, 10)
            .await
            .unwrap();
        assert_eq!(text, "中🙂中");
        assert!(truncated);
    }

    #[tokio::test]
    async fn managed_command_starts_and_preserves_exit_status() {
        #[cfg(unix)]
        let mut command = {
            let mut c = Command::new("/bin/sh");
            c.args(["-c", "printf ready; exit 7"]);
            c
        };
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("cmd.exe");
            c.args(["/D", "/C", "echo ready & exit /B 7"]);
            c
        };
        let result = output(
            &mut command,
            OutputEncoding::Utf8,
            Duration::from_secs(10),
            100,
        )
        .await
        .unwrap();
        assert!(result.stdout.contains("ready"));
        assert_eq!(result.status.code(), Some(7));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_and_cancellation_stop_descendants() {
        for cancel in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let marker = temp.path().join("escaped");
            let ready = temp.path().join("ready");
            let mut command = Command::new("/bin/sh");
            command
                .args([
                    "-c",
                    "(sleep 1; echo leaked > \"$MARKER\") & echo ready > \"$READY\"; wait",
                ])
                .env("MARKER", &marker)
                .env("READY", &ready);
            let task = tokio::spawn(async move {
                output(
                    &mut command,
                    OutputEncoding::Utf8,
                    Duration::from_millis(400),
                    100,
                )
                .await
            });
            tokio::time::timeout(Duration::from_secs(3), async {
                while !ready.exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            if cancel {
                task.abort();
                assert!(task.await.unwrap_err().is_cancelled());
            } else {
                assert!(task.await.unwrap().is_err());
            }
            tokio::time::sleep(Duration::from_millis(1100)).await;
            assert!(!marker.exists(), "descendant survived cleanup");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn leader_exit_cleans_descendants_holding_pipes() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("escaped");
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "(sleep 1; echo leaked > \"$MARKER\") & exit 0"])
            .env("MARKER", &marker);
        let result = output(
            &mut command,
            OutputEncoding::Utf8,
            Duration::from_secs(3),
            100,
        )
        .await
        .unwrap();
        assert!(result.status.success());
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert!(!marker.exists());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_job_stops_child_on_cancellation() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("escaped");
        let ready = temp.path().join("ready");
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "$p = Start-Process powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep 3; Set-Content -LiteralPath $env:MARKER -Value leaked' -PassThru; Set-Content -LiteralPath $env:READY -Value ready; Start-Sleep 60"])
            .env("MARKER", &marker).env("READY", &ready);
        let task = tokio::spawn(async move {
            output(
                &mut command,
                OutputEncoding::Utf8,
                Duration::from_secs(30),
                100,
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(20), async {
            while !ready.exists() {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::sleep(Duration::from_secs(4)).await;
        assert!(!marker.exists(), "Job Object failed to clean descendants");
    }
}
