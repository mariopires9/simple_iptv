# Compatibility matrix (DEP-02)

Only what is recorded here as **pass** may be claimed as compatible. One row per device +
browser + checklist step group from [`DEP-02.md`](DEP-02.md). Never paste credentials, hosts or
stream URLs; masked "Copy details" text is fine.

| Date | Device | OS + version | Browser + version | Steps | Result | Notes |
|---|---|---|---|---|---|---|
| 2026-11-02 | iPhone (owner) + Linux server | iOS (version not recorded); server Linux, Node 24 | Safari / installed PWA | D1–D5 (personal proxy over Tailscale Serve) | pass | Proxy on Linux (systemd), Tailscale on server and iPhone; Test connection OK; list routed through the proxy; activeUpstreams back to 0 after closing the player; logs show no URLs. Reported by the owner. |
| | | | | | | |
