# Source provenance

- Client: https://github.com/baiye0/loom-local, original base commit `5d347107326fd754fafea1c1dc373a42986ff49f`.
- Heart Portal: https://github.com/baiye0/heart-portal, Git submodule at `heart-portal/`, tracking `codex/town-client-compat` for explicit source updates.
- Pinned compatibility revision: `94bd6f6d9362c71930aca52f448e73f056ab7b40` on `codex/town-client-compat`.
- Upstream Portal base: `79657ab` (0.8.2), including the Windows screenshot fix and removal of built-in web search, merged with the existing client compatibility changes. The parent repository's gitlink is the authoritative build revision.

The compatibility branch is based on upstream main. It keeps client-managed
launches in place, publishes connection state on both platforms, and prevents
standalone engine upgrades from bypassing the client transaction. See
`heart-portal/docs/town-client.md`. No separate Portal release is required.
Client packaging compiles the pinned source on the target operating system and
ships the resulting engine inside the same client release.

Clone with `git clone --recurse-submodules`, or initialize an existing clone with
`git submodule update --init --recursive`. After pulling Portal Desktop, run the latter
command again to use its recorded Portal revision. Builds never follow a moving
branch or run `git pull` automatically.

Keep all Portal Desktop compatibility changes on the long-lived
`codex/town-client-compat` branch in the Portal repository. Merge upstream updates
into that branch, verify the client and engine together, and publish the Portal
commit before updating the client gitlink. Do not point the client at a temporary
local branch or directly at upstream main.

To intentionally update Portal: run `git submodule update --remote heart-portal`,
verify the client and engine together, then commit the `heart-portal` gitlink in
Portal Desktop. Retain the original license notices in `heart-portal/LICENSE` and
`resources/HEART-PORTAL-LICENSE`.
