//! Public web fetch. Every redirect is resolved, checked and pinned before connecting.
use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde_json::Value;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

pub fn is_safe_url(value: &str) -> bool {
    url::Url::parse(value).ok().is_some_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && url.host().is_some_and(|host| match host {
                url::Host::Domain(name) => {
                    let name = name.trim_end_matches('.');
                    name != "localhost"
                        && !name.ends_with(".localhost")
                        && !name.ends_with(".local")
                }
                url::Host::Ipv4(ip) => ip_is_safe(ip.into()),
                url::Host::Ipv6(ip) => ip_is_safe(ip.into()),
            })
    })
}

fn ip_is_safe(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_documentation()
                || a == 0
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && (c == 0 || c == 2))
                || (a == 198 && (b == 18 || b == 19)))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return ip_is_safe(v4.into());
            }
            let s = ip.segments();
            // Only global unicast, excluding special assignments / transition
            // ranges (including NAT64 and 6to4, which can encode private IPv4).
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

async fn addresses(url: &url::Url) -> Result<(String, Vec<SocketAddr>)> {
    let host = url.host().context("Missing host")?;
    let port = url.port_or_known_default().context("Missing port")?;
    let host = match host {
        url::Host::Domain(name) => name.to_owned(),
        url::Host::Ipv4(ip) => ip.to_string(),
        url::Host::Ipv6(ip) => ip.to_string(),
    };
    let resolved: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .context("DNS lookup failed")?
        .collect();
    anyhow::ensure!(
        !resolved.is_empty() && resolved.iter().all(|addr| ip_is_safe(addr.ip())),
        "Destination is not a public address"
    );
    Ok((host, resolved))
}

pub async fn fetch(arguments: Value) -> Result<Value> {
    let input = arguments
        .get("url")
        .and_then(Value::as_str)
        .context("Missing 'url' argument")?;
    let limit = arguments
        .get("max_chars")
        .and_then(super::value_as_u64)
        .unwrap_or(50_000)
        .min(1_000_000) as usize;
    let mut url = url::Url::parse(input).context("Invalid URL")?;
    let work = async {
        for redirects in 0..=5 {
            anyhow::ensure!(is_safe_url(url.as_str()), "URL is not allowed");
            let (host, addresses) = addresses(&url).await?;
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .resolve_to_addrs(&host, &addresses)
                .timeout(Duration::from_secs(10))
                .user_agent("heart-portal")
                .build()?;
            let response = client
                .get(url.clone())
                .send()
                .await
                .map_err(|e| e.without_url())?;
            if response.status().is_redirection() {
                anyhow::ensure!(redirects < 5, "Too many redirects");
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .context("Redirect has no location")?
                    .to_str()?;
                let next = url.join(location).context("Invalid redirect")?;
                anyhow::ensure!(
                    url.scheme() != "https" || next.scheme() == "https",
                    "HTTPS downgrade redirect rejected"
                );
                url = next;
                continue;
            }
            let response = response.error_for_status().map_err(|e| e.without_url())?;
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| e.without_url())?;
                let remaining = (limit + 1).saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if bytes.len() > limit {
                    break;
                }
            }
            let body = String::from_utf8_lossy(&bytes);
            let prefix = super::text::byte_prefix(&body, limit);
            let text = if bytes.len() > limit || body.len() > limit {
                format!("{prefix}...\n(truncated at {} bytes)", prefix.len())
            } else {
                body.into_owned()
            };
            return Ok(serde_json::json!({"content": [{"type":"text", "text":text}]}));
        }
        anyhow::bail!("Too many redirects")
    };
    tokio::time::timeout(Duration::from_secs(15), work)
        .await
        .context("web_fetch timed out")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_multibyte_scheme_without_panicking() {
        for url in ["中文🙂", "https中://example.com", "http中://example.com"] {
            assert!(!is_safe_url(url));
        }
    }

    #[test]
    fn allows_public_https() {
        assert!(is_safe_url("https://example.com/path"));
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(!is_safe_url("file:///etc/passwd"));
    }

    #[test]
    fn rejects_loopback() {
        assert!(!is_safe_url("http://127.0.0.1/"));
        assert!(!is_safe_url("http://localhost/"));
        assert!(!is_safe_url("http://[::1]/"));
    }

    #[test]
    fn rejects_private_and_link_local() {
        assert!(!is_safe_url("http://10.0.0.1/"));
        assert!(!is_safe_url("http://172.20.1.1/"));
        assert!(!is_safe_url("http://192.168.0.1/"));
        assert!(!is_safe_url("http://169.254.169.254/latest/meta-data/"));
    }
}

#[cfg(test)]
mod address_tests {
    use super::*;
    #[test]
    fn rejects_alternate_private_addresses_and_credentials() {
        for value in [
            "http://2130706433",
            "http://0x7f000001",
            "http://127.1",
            "http://localhost.",
            "http://user:pass@example.com",
            "http://[::ffff:127.0.0.1]",
            "http://100.64.0.1",
            "http://224.0.0.1",
            "http://[64:ff9b::7f00:1]",
        ] {
            assert!(!is_safe_url(value), "{value}");
        }
    }
    #[tokio::test]
    async fn refuses_private_fetch_before_connecting() {
        assert!(fetch(serde_json::json!({"url":"http://127.0.0.1:1"}))
            .await
            .unwrap_err()
            .to_string()
            .contains("not allowed"));
    }
}
