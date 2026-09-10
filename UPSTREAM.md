# Source provenance

- Client: https://github.com/baiye0/loom-local, original base commit `5d347107326fd754fafea1c1dc373a42986ff49f`.
- Heart Portal: https://github.com/baiye0/heart-portal, Git submodule at `heart-portal/`, tracking `main` for explicit source updates.
- Current Portal base: `225d7b38c446f1d589465977a5aec3c399ba4b37` (0.8.2). The parent repository's gitlink is the authoritative build revision.

The submodule contains unmodified upstream source. Client integration stays in
`desktop/`; no separate client-specific Portal branch or release is required.
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
