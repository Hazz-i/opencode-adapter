<div align="center">

# opencode-adapter

**Expose OpenCode Zen free-tier models as an adaptive OpenAI-compatible provider for 9Router.**
No OpenCode account, no API key, no subscription — self-updating local or remote adapter.

Free models · adaptive live sync · attested free-tier client · OpenAI-compatible · zero dependencies

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)
[![OpenCode](https://img.shields.io/badge/upstream-opencode.ai-18181b?style=flat-square)](https://opencode.ai)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](https://github.com/Hazz-i/opencode-adapter/pulls)

</div>

---

## What it is

OpenCode ships a **free tier** of models you can use at no cost. Access is gated though:
the gateway answers `403 FreeTierError: "OpenCode's free tier can only be used from within OpenCode"`
unless the request carries the official client's fingerprint.

`opencode-adapter` reproduces that fingerprint in a tiny adapter with **adaptive auto-discovery**, so **9Router — and anything pointed at 9Router — can call these models for free without manual model maintenance.**

```
OpenAI client ──▶ 9Router :20128/v1 ──▶ provider-node "OpenCode Free"
              ──▶ adapter :8790/v1 ──▶ opencode.ai/zen/v1  (Bearer public + attestation)
```

> See **[STRUCTURE.md](STRUCTURE.md)** for the full topology, file map and data-flow diagrams.

---

## Adaptive Free Models

OpenCode regularly rotates its free models (deprecating older ones and introducing new ones). **This adapter queries OpenCode Zen dynamically** (`/models`) on startup and every 30 minutes in the background, automatically keeping the model catalog fresh.

| Model | Endpoint | Context | Notes |
|-------|----------|---------|-------|
| `cat-jam-free` | chat/completions | 1M | newly released, auto-discovered |
| `big-pickle` | chat/completions | 200K | general reasoning |
| `ling-3.1-flash-free` | chat/completions | 262K | fast flash |
| `longcat-2.5-preview-free` | chat/completions | 1M | long context |
| `mimo-v2.6-flash-free` | chat/completions | 200K | compact flash |
| `nemotron-3.5-lightning-free` | chat/completions | 262K | low latency |
| `space-bunny-free` | chat/completions | 1M | 512K output |
| `step-5-preview-free` | chat/completions | 1M | StepFun flagship, text+image+video |
| `muse-spark-1.2-contributor-free` | responses | 1M | contributor model |
| `muse-spark-1.3-contributor-free` | responses | 1M | contributor model |

**Auto-retired**: Models that become deprecated upstream (such as `fledge-alpha-free`, `exo-free`) are automatically dropped from the routing list.

**Not proxied**: `jev-1.13-free` (uses SystemOne protocol; handled natively by 9Router).

Run `node src/cli.js list` to view the live list detected right now.

---

## Quick Start (Local Setup)

Requires **Node.js >= 18**. Zero dependencies.

```bash
git clone https://github.com/Hazz-i/opencode-adapter.git
cd opencode-adapter

# 1. start the adapter (http://127.0.0.1:8790/v1)
node src/adapter.js

# 2. in another shell, register it in 9Router (if running locally)
node src/connect-9router.js
```

### Try a model directly

```bash
node src/cli.js ask cat-jam-free "Explain closures in one line"
node src/cli.js check          # live-probe every active model
```

---

## Setup on a Server with Deployed 9Router

If your 9Router is deployed remotely on a VPS/cloud server (for example at `https://nine.example.com`), follow one of these setups:

### Option A: Run Adapter on the Same VPS (Recommended)

Running the adapter on the same server as 9Router ensures minimal latency and secure local communication without exposing extra ports to the public internet:

1. **Clone and enter repository on your VPS:**
   ```bash
   git clone https://github.com/Hazz-i/opencode-adapter.git
   cd opencode-adapter
   ```

2. **Start adapter as a background service:**
   Using PM2:
   ```bash
   npm install -g pm2 # if not already installed
   pm2 start src/adapter.js --name opencode-adapter
   pm2 save
   ```
   Or using systemd / nohup:
   ```bash
   nohup node src/adapter.js > adapter.log 2>&1 &
   ```

3. **Register provider inside 9Router:**
   Directly on the VPS:
   ```bash
   node src/connect-9router.js
   ```
   Or configure it via Web Dashboard (Option B).

---

### Option B: Register Manually via 9Router Web Dashboard

You do not need to run `connect-9router.js` if you have access to the 9Router Web UI:

1. Open your 9Router Web Dashboard in a browser: `https://nine.example.com/dashboard`
2. Go to **Providers** / **Provider Nodes** ➔ click **Add Provider** (or **Add Custom Node**).
3. Fill in the details:
   - **Name**: `OpenCode Free`
   - **Prefix**: `ocfree`
   - **Type**: `openai-compatible`
   - **Base URL**: `http://127.0.0.1:8790/v1` *(if running on the same VPS)* or your public tunnel URL
   - **API Key**: `sk-opencode-free`
   - **API Type**: `chat`
4. Click **Save**.
5. All live models will immediately show up under `ocfree/...`. You can click **Refresh Models** on the provider card anytime to force an instant sync.

---

### Option C: Adapter on Local PC + Remote 9Router (via Tunnel)

If you prefer keeping the adapter running on your local computer while 9Router runs on a remote server:

1. Start the adapter on your local machine:
   ```bash
   node src/adapter.js
   ```

2. Expose port `8790` to the internet using Cloudflare Tunnel or ngrok:
   ```bash
   npx cloudflared tunnel --url http://127.0.0.1:8790
   # or: ngrok http 8790
   ```
   You will receive a public HTTPS URL (e.g. `https://my-adapter.trycloudflare.com`).

3. In your remote 9Router Web Dashboard, set the Provider **Base URL** to:
   ```
   https://my-adapter.trycloudflare.com/v1
   ```

---

## Running in the Background with PM2

To keep the adapter running continuously on your local PC or VPS server across restarts, use [PM2](https://pm2.keymetrics.io/):

### 1. Install PM2
```bash
npm install -g pm2
```

### 2. Start the Adapter
```bash
cd opencode-adapter
pm2 start src/adapter.js --name opencode-adapter
```
*(The adapter automatically reads your `.env` file on startup).*

### 3. Enable Auto-Start on System Boot
To make PM2 automatically relaunch the adapter after a server reboot:
```bash
pm2 startup
pm2 save
```

### 4. Useful Management Commands
| Task | Command |
|---|---|
| **View logs** | `pm2 logs opencode-adapter` |
| **Check status / memory** | `pm2 status` |
| **Restart adapter** | `pm2 restart opencode-adapter` |
| **Stop adapter** | `pm2 stop opencode-adapter` |
| **Delete from PM2** | `pm2 delete opencode-adapter` |

---

## Configuration & Environment Variables

You can configure the adapter and connector via `.env`:

| Variable | Default | Purpose / Meaning |
|---|---|---|
| `PORT` | `8790` | Port the adapter listens on. |
| `HOST` | `127.0.0.1` | Host address to bind (`127.0.0.1` for local only, `0.0.0.0` for all interfaces). |
| `ADAPTER_API_KEY` | `sk-opencode-free` | **Security API Key**. If set, callers (including 9Router) must pass `Authorization: Bearer <key>`. If empty, requests without a key are accepted. |
| `QUIET` | `0` | **Log verbosity**. Set to `1` to suppress runtime error logs in console (`[adapter] model -> error`). Set to `0` to log errors. |
| `ROUTER_URL` | `http://127.0.0.1:20128` | 9Router base URL used by `connect-9router.js`. |
| `ADAPTER_URL` | `http://127.0.0.1:8790/v1` | Adapter base URL registered into 9Router. |
| `PROVIDER_NAME` | `OpenCode Free` | Name of the provider displayed in the 9Router dashboard. |
| `PROVIDER_PREFIX` | `ocfree` | Model prefix in 9Router (models appear as `ocfree/<model>`). |
| `NINEROUTER_CLI_TOKEN` | — | Fallback CLI device token for 9Router raw HTTP requests. |

The gateway only serves free models to requests matching the official OpenCode client. The adapter automatically injects:

| Signal | Value |
|--------|-------|
| `User-Agent` | `opencode/<version>` (version >= 1.17) |
| `x-opencode-client` | `desktop` |
| `x-opencode-session` | `ses_<12 hex><14 base62>` — stable per identity |
| `x-opencode-request` | `msg_<12 hex><14 base62>` — stable per turn |
| `Authorization` | `Bearer public` |
| `stream` (body) | `true` — non-streaming requests are rejected |
| `tools` (body) | `bash`, `glob`, `grep`, `read` — fingerprint quartet |

Everything lives in [`src/opencode_free.js`](src/opencode_free.js) and is verified by `npm test`.

---

## Project Layout

```
opencode-adapter/
├── src/
│   ├── opencode_free.js     # attestation, ids, shaping, adaptive discovery, complete()
│   ├── adapter.js           # OpenAI-compatible HTTP server (:8790/v1) with 30-min auto-sync
│   ├── connect-9router.js   # registers provider in 9Router with .env auto-load
│   ├── cli.js               # list / ask / check
│   └── selftest.js          # offline + live checks
├── STRUCTURE.md             # topology, file map, data-flow diagrams
└── package.json
```

---

## Testing

```bash
npm test              # offline: 11 checks, instant
npm run test:live     # live checks against opencode.ai
```

---

## Legal and Fair Use

This project is **unofficial** and not affiliated with OpenCode or 9Router. It uses the free tier as the OpenCode client does. Free tiers have rate limits and change without notice — respect upstream terms of service, keep request volume reasonable, and do not resell access. Use at your own risk.

---

## License

[MIT](LICENSE) © 2026 Hazz-i
