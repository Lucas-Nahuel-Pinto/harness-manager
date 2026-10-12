# Online vs. 100% offline

Why harness-manager ships a hosted UI instead of a local server or desktop app — the comparison behind the "100% online" pivot (spec: `docs/superpowers/specs/2026-10-11-web-picker-agent-design.md`).

## What "online" means here

Online does **not** move the engine to the cloud. The engine must read the operator's working tree (`.env`, `node_modules`, source files), so that process always runs locally. Only the **interface and the channel** moved:

```
100% offline:  [desktop app or loopback server] ── local HTTP ──► engine on your PC

online today:  [any browser → hosted site] ── E2E-encrypted WSS ──► relay Worker ──► local agent (engine)
```

The hosted site holds the dashboard and the harness picker; a headless local agent (`bun agent.ts`) joins the relay and executes everything real.

## Problems solved vs. 100% offline

| Problem in a 100% offline design | How online solves it |
| --- | --- |
| UI reachable only from the same machine (`127.0.0.1`) | Any device with a browser + the URL: phone, second PC, different network |
| Remote access meant opening ports / VPN / port-forwarding — per-network setup and attack surface | The agent only opens **outbound** WSS connections: no inbound ports, works behind NAT, firewalls and corporate networks without touching them |
| Exposing a local server on the LAN sent traffic in clear text (HTTP) | Frames are E2E encrypted (AES-GCM): the relay — including our own Worker — only forwards opaque bytes; the session code travels in the URL fragment and never reaches any server |
| Desktop app (Electrobun): per-OS packaging, signing, update channel, native window | Zero client installation — the UI is a URL; the whole desktop app was deleted |
| Every machine runs its own copy of the code → version drift | One artifact: a single deploy gives every browser the latest UI on the next reload — nothing to install or update anywhere |
| Loopback port conflicts (`7399` occupied, "port in use", firewall prompts) | No local port and no window at all — exactly one headless terminal process |
| Local server dies → everything dies (closed terminal, reboot) | Self-healing: the agent reconnects with backoff, rooms live 24h idle, the UI reconnects and shows an explicit "agent disconnected" banner |
| Several delivery modes to maintain (desktop app + `file://` embedded build + local server) | One web bundle (the local fetch path survives only as a fallback for loopback/file origins) |
| Updating the UI meant restarting the local process | Deploying never disturbs the running agent; UI and engine evolve independently |

## Advantages a 100% offline design never had

- **Simultaneous multi-device**: several tabs or phones in the same room (the relay supports multiple `ui` members).
- **Share the control**: send the pairing URL and someone else operates the harness from their own machine — offline, the only option was screen sharing.
- **Best of both worlds by design**: the engine stays where it must be (your local filesystem) and the interface goes wherever you are.
- **Thin client**: the viewing machine needs neither Bun nor anything installed.

## Honest tradeoffs

- Internet is a hard requirement — a pure-offline build worked without a network. **LAN / no-internet mode is an explicit non-goal** (spec's non-goals section); revisit only if there is real demand.
- Availability depends on Cloudflare Workers.
- One extra network hop per request through the relay — negligible for snapshot reads and confirmed actions.

## References

- Spec: `docs/superpowers/specs/2026-10-11-web-picker-agent-design.md`
- Acceptance: `docs/acceptance.md`
