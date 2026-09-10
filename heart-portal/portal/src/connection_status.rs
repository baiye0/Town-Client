//! A small status file shared by native supervisors and desktop observers.
//! It is telemetry only: never use it to authorize execution or take ownership.
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

struct Publisher {
    path: PathBuf,
    nonce: String,
    boot: String,
    sequence: u64,
    state: String,
    last: std::time::Instant,
}
static PUBLISHER: OnceLock<Option<Mutex<Publisher>>> = OnceLock::new();

fn installation_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    #[cfg(target_os = "macos")]
    {
        crate::macos_upgrade::installation_root(&exe).ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(exe.parent()?.to_path_buf())
    }
}

fn target() -> Option<(PathBuf, String)> {
    if let (Some(path), Ok(nonce)) = (
        std::env::var_os("HEART_PORTAL_STATUS_FILE"),
        std::env::var("HEART_PORTAL_STATUS_NONCE"),
    ) {
        return Some((path.into(), nonce));
    }
    if let (Some(ready), Ok(nonce)) = (
        std::env::var_os("HEART_PORTAL_READY_FILE"),
        std::env::var("HEART_PORTAL_READY_NONCE"),
    ) {
        return Some((
            PathBuf::from(ready).with_file_name(".portal-connection-status.json"),
            nonce,
        ));
    }
    let root = installation_root()?;
    let nonce = std::fs::read_to_string(root.join(".portal-status-nonce"))
        .or_else(|_| std::fs::read_to_string(root.join(".portal-launch-nonce")))
        .ok()?;
    Some((
        root.join(".portal-connection-status.json"),
        nonce.trim().into(),
    ))
}

pub fn publish(state: &str) {
    let publisher = PUBLISHER.get_or_init(|| {
        target().map(|(path, nonce)| {
            Mutex::new(Publisher {
                path,
                nonce,
                boot: uuid::Uuid::new_v4().to_string(),
                sequence: 0,
                state: String::new(),
                last: std::time::Instant::now(),
            })
        })
    });
    let Some(publisher) = publisher else {
        return;
    };
    let Ok(mut publisher) = publisher.lock() else {
        return;
    };
    if publisher.state == state && publisher.last.elapsed() < std::time::Duration::from_secs(5) {
        return;
    }
    publisher.state = state.to_owned();
    publisher.last = std::time::Instant::now();
    publisher.sequence += 1;
    let status = serde_json::json!({
        "schema": 1, "pid": std::process::id(), "nonce": publisher.nonce,
        "boot_id": publisher.boot, "sequence": publisher.sequence, "state": state,
        "version": crate::upgrade::PORTAL_VERSION,
        "updated_at_ms": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
    });
    if let Err(error) = write_atomic(&publisher.path, &status) {
        tracing::warn!("Could not publish Portal status: {error}");
    }
}

fn write_atomic(path: &std::path::Path, value: &serde_json::Value) -> anyhow::Result<()> {
    use std::io::Write;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        #[cfg(windows)]
        let mut file = crate::windows_private::create(&temporary)?;
        #[cfg(not(windows))]
        let mut file = {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options.open(&temporary)?
        };
        file.write_all(&serde_json::to_vec(value)?)?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        anyhow::Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub fn show() -> anyhow::Result<()> {
    let path = target()
        .map(|(path, _)| path)
        .or_else(|| Some(installation_root()?.join(".portal-connection-status.json")))
        .ok_or_else(|| anyhow::anyhow!("No status location"))?;
    let status: serde_json::Value = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            serde_json::json!({"state":"unknown"})
        }
        Err(error) => return Err(error.into()),
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let fresh = status["updated_at_ms"]
        .as_u64()
        .is_some_and(|updated| updated <= now + 5000 && now.saturating_sub(updated) < 120_000);
    println!("{}", serde_json::json!({"sample":status,"fresh":fresh}));
    Ok(())
}
