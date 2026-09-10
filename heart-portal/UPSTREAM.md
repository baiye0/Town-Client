# Portal source

Source: https://github.com/baiye0/heart-portal

Revision: `225d7b38c446f1d589465977a5aec3c399ba4b37` (Portal 0.8.2).

The client includes source rather than fetching a moving branch during builds.
Desktop integration retains nonce-bound connection telemetry, loopback and
authenticated TCP defaults, bounded tool I/O and child cleanup. Explicitly
configured or OS-supervised launches keep their installation directory; the
client owns their upgrade transaction instead of relocating the running engine.
Upstream MCP ownership, configuration diagnostics, kit lifecycle and recovery
changes are included. User configuration and credentials are never vendored.
