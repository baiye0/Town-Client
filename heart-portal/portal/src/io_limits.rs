//! Bounded, cancellation-safe newline framing shared by TCP, relay and MCP.
use anyhow::{Context, Result};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
pub(crate) const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub(crate) async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    partial: &mut Vec<u8>,
    limit: usize,
) -> Result<Option<String>> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if partial.is_empty() {
                return Ok(None);
            }
            return Ok(Some(String::from_utf8(std::mem::take(partial))?));
        }
        let count = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(available.len());
        anyhow::ensure!(
            partial.len().saturating_add(count) <= limit,
            "Protocol frame exceeds {limit} bytes"
        );
        partial.extend_from_slice(&available[..count]);
        let done = available[count - 1] == b'\n';
        reader.consume(count);
        if done {
            return Ok(Some(String::from_utf8(std::mem::take(partial))?));
        }
    }
}

pub(crate) async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, json: &str) -> Result<()> {
    anyhow::ensure!(
        json.len() < MAX_FRAME_BYTES,
        "Protocol response exceeds frame limit"
    );
    tokio::time::timeout(WRITE_TIMEOUT, async {
        writer.write_all(json.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await
    })
    .await
    .context("Protocol write timed out; delivery is unknown")??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn partial_frame_survives_cancel_and_oversize_is_rejected() {
        let (mut send, recv) = tokio::io::duplex(64);
        let mut reader = tokio::io::BufReader::new(recv);
        let mut partial = vec![];
        send.write_all(b"{\"id\":").await.unwrap();
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            read_frame(&mut reader, &mut partial, 20)
        )
        .await
        .is_err());
        send.write_all(b"1}\n").await.unwrap();
        assert_eq!(
            read_frame(&mut reader, &mut partial, 20)
                .await
                .unwrap()
                .unwrap(),
            "{\"id\":1}\n"
        );
        send.write_all(b"123456789").await.unwrap();
        assert!(read_frame(&mut reader, &mut partial, 8).await.is_err());
    }
}
