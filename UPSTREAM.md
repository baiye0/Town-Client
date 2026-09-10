# Source provenance

- Client: https://github.com/baiye0/loom-local, original base commit `5d347107326fd754fafea1c1dc373a42986ff49f`.
- Heart Portal: https://github.com/baiye0/heart-portal, Git submodule at `heart-portal/`, tracking `codex/town-client-compat` for explicit source updates.
- Pinned compatibility revision: `2457776a3bb0fc8502b7864759d520ad6c7ac0e1`.
- Upstream Portal base: `225d7b38c446f1d589465977a5aec3c399ba4b37` (0.8.2). The parent repository's gitlink is the authoritative build revision.

The compatibility branch is based on upstream main. It keeps client-managed
launches in place, publishes connection state on both platforms, and prevents
standalone engine upgrades from bypassing the client transaction. See
`heart-portal/docs/town-client.md`. No separate Portal release is required.
Client packaging compiles the pinned source on the target operating system and
ships the resulting engine inside the same client release.

Clone with `git clone --recurse-submodules`, or initialize an existing clone with
`git submodule update --init --recursive`. After pulling Town-Client, run the latter
command again to use its recorded Portal revision. Builds never follow a moving
branch or run `git pull` automatically.

To intentionally update Portal: run `git submodule update --remote heart-portal`,
verify the client and engine together, then commit the `heart-portal` gitlink in
Town-Client. Retain the original license notices in `heart-portal/LICENSE` and
`resources/HEART-PORTAL-LICENSE`.

The `hardening/` directory contains historical design and verification notes from
the original workspace; they are not a description of the current source layout.
