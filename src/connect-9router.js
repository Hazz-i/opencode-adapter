#!/usr/bin/env node
/**
 * connect-9router.js
 * ---------------------------------------------------------------------------
 * Registers the OpenCode free adapter inside 9Router as a custom
 * OpenAI-compatible provider node, then attaches an API-key connection so its
 * models go live in the router.
 *
 * Supports:
 *   - Local 9Router (via global npm client)
 *   - Docker-deployed 9Router (auto-detects container, retrieves token, resolves bridge URL)
 *   - Remote 9Router (via NINEROUTER_CLI_TOKEN)
 *
 * Zero dependencies.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { workingModels, syncFreeModels } from "./opencode_free.js";

try {
  process.loadEnvFile?.();
} catch {}

const require = createRequire(import.meta.url);

const ROUTER = process.env.ROUTER_URL || "http://127.0.0.1:20128";
const ADAPTER = process.env.ADAPTER_URL || "http://127.0.0.1:8790/v1";
const ADAPTER_KEY = process.env.ADAPTER_API_KEY || "sk-opencode-free";
const NAME = process.env.PROVIDER_NAME || "OpenCode Free";
const PREFIX = process.env.PROVIDER_PREFIX || "ocfree";

/** Try to locate 9Router's own installed API client. */
function findRouterClient() {
  const candidates = [
    process.env.NINEROUTER_CLIENT,
    "/usr/local/lib/node_modules/9router/src/cli/api/client.js",
    "/usr/lib/node_modules/9router/src/cli/api/client.js",
    path.join(os.homedir(), ".npm-global/lib/node_modules/9router/src/cli/api/client.js"),
    "/opt/homebrew/lib/node_modules/9router/src/cli/api/client.js",
  ];
  try {
    const npmRoot = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    if (npmRoot) candidates.push(path.join(npmRoot, "9router/src/cli/api/client.js"));
  } catch {}
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Try to locate a running 9Router Docker container. */
function findDockerContainer() {
  try {
    const list = execSync('docker ps --format "{{.Names}}\t{{.Image}}"', {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim().split("\n");
    for (const line of list) {
      const [name, image] = line.split("\t");
      if (!name) continue;
      if (name.includes("9router") || (image && (image.includes("9router") || image.includes("decolua")))) {
        return name.trim();
      }
    }
  } catch {}
  return null;
}

/** Try to derive the CLI token directly from the Docker container. */
function findDockerCliToken(containerName) {
  if (!containerName) return null;
  try {
    const script = `
      const fs = require('fs');
      const crypto = require('crypto');
      const dirs = ['/app/data', '/root/.9router', '/home/node/.9router', (process.env.HOME || '') + '/.9router'];
      for (const d of dirs) {
        if (!d) continue;
        try {
          const mid = fs.readFileSync(d + '/machine-id', 'utf8').trim();
          const sec = fs.readFileSync(d + '/auth/cli-secret', 'utf8').trim();
          if (mid && sec) {
            console.log(crypto.createHash('sha256').update(mid + '9r-cli-auth' + sec).digest('hex').slice(0, 16));
            process.exit(0);
          }
        } catch {}
      }
    `;
    const token = execSync(`docker exec ${containerName} node -e "${script.replace(/\n\s*/g, ' ')}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

/** Check which URL the 9Router Docker container can reach the host adapter at. */
function resolveDockerAdapterUrl(containerName, adapterUrl) {
  if (!containerName) return adapterUrl;
  if (!adapterUrl.includes("127.0.0.1") && !adapterUrl.includes("localhost") && !adapterUrl.includes("0.0.0.0")) {
    return adapterUrl;
  }

  const testPath = "/health";
  // 1. Check if 127.0.0.1 works (works if container runs with --net host)
  try {
    const healthUrl = adapterUrl.replace(/\/v1\/?$/, testPath);
    execSync(`docker exec ${containerName} node -e "fetch('${healthUrl}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`, {
      stdio: "ignore",
    });
    return adapterUrl;
  } catch {}

  // 2. Check 172.17.0.1 (Docker default bridge gateway to host)
  const bridgeUrl = adapterUrl.replace(/127\.0\.0\.1|localhost|0\.0\.0\.0/, "172.17.0.1");
  try {
    const healthUrl = bridgeUrl.replace(/\/v1\/?$/, testPath);
    execSync(`docker exec ${containerName} node -e "fetch('${healthUrl}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`, {
      stdio: "ignore",
    });
    return bridgeUrl;
  } catch {}

  // 3. Check host.docker.internal
  const hostDockerUrl = adapterUrl.replace(/127\.0\.0\.1|localhost|0\.0\.0\.0/, "host.docker.internal");
  try {
    const healthUrl = hostDockerUrl.replace(/\/v1\/?$/, testPath);
    execSync(`docker exec ${containerName} node -e "fetch('${healthUrl}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`, {
      stdio: "ignore",
    });
    return hostDockerUrl;
  } catch {}

  return bridgeUrl;
}

/** Fallback: raw HTTP with an explicit CLI token. */
async function rawRequest(method, pathname, body, token) {
  if (!token) {
    throw new Error(
      "no 9router client found and NINEROUTER_CLI_TOKEN is not set; run `npm i -g 9router` or export the token",
    );
  }
  const res = await fetch(`${ROUTER}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", "x-9r-cli-token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function makeClient(dockerContainer, dockerToken) {
  const clientPath = findRouterClient();
  if (clientPath) {
    const api = require(clientPath);
    return {
      kind: `9router client (${clientPath})`,
      async listNodes() {
        const r = await api.getProviderNodes();
        return r.data?.nodes || [];
      },
      createNode: (body) => api.createProviderNode(body),
      createConnection: (body) => api.createApiKeyProvider(body),
      listProviders: () => api.getProviders(),
    };
  }

  const token = process.env.NINEROUTER_CLI_TOKEN || dockerToken;
  const kind = dockerToken
    ? `raw HTTP (auto-authenticated from Docker container "${dockerContainer}")`
    : "raw HTTP (NINEROUTER_CLI_TOKEN)";

  return {
    kind,
    async listNodes() {
      const r = await rawRequest("GET", "/api/provider-nodes", null, token);
      return r.data?.nodes || r.nodes || [];
    },
    createNode: (body) => rawRequest("POST", "/api/provider-nodes", body, token),
    createConnection: (body) => rawRequest("POST", "/api/providers", body, token),
    listProviders: () => rawRequest("GET", "/api/providers", null, token),
  };
}

async function checkAdapter() {
  try {
    const res = await fetch(`${ADAPTER.replace(/\/v1$/, "")}/health`);
    if (!res.ok) throw new Error(String(res.status));
  } catch (err) {
    console.error(`!! adapter not reachable at ${ADAPTER} (${err.message})`);
    console.error("   start it first:  pm2 start src/adapter.js");
    process.exit(1);
  }
}

async function main() {
  console.log(`9Router : ${ROUTER}`);
  console.log(`adapter : ${ADAPTER}`);
  await checkAdapter();

  const dockerContainer = findDockerContainer();
  let dockerToken = null;
  let targetAdapterUrl = ADAPTER;

  if (dockerContainer) {
    console.log(`docker  : detected container "${dockerContainer}"`);
    dockerToken = findDockerCliToken(dockerContainer);
    if (dockerToken) {
      console.log(`auth    : successfully extracted CLI token from container`);
    }
    targetAdapterUrl = resolveDockerAdapterUrl(dockerContainer, ADAPTER);
    if (targetAdapterUrl !== ADAPTER) {
      console.log(`bridge  : adjusted adapter URL for Docker: ${targetAdapterUrl}`);
    }
  }

  const client = makeClient(dockerContainer, dockerToken);
  console.log(`api     : ${client.kind}`);

  // 1. provider node (idempotent: reuse if a node with this name exists)
  const nodes = await client.listNodes();
  let node = nodes.find((n) => n.name === NAME);
  if (node) {
    console.log(`provider node "${NAME}" already exists (${node.id})`);
  } else {
    const body = {
      name: NAME,
      prefix: PREFIX,
      baseUrl: targetAdapterUrl,
      type: "openai-compatible",
      apiType: "chat",
    };
    const res = await client.createNode(body);
    node = res.node || res.data?.node || res.data || res;
    console.log(`provider node "${NAME}" created (${node.id || "?"})`);
  }

  // 2. api-key connection so the node is active
  const providers = await client.listProviders();
  const connections = providers.data?.connections || providers.connections || [];
  const hasConn = connections.some(
    (c) => c.provider === node.id || c.providerId === node.id,
  );
  if (hasConn || process.env.SKIP_CONNECTION === "1") {
    console.log("api-key connection already present (or skipped)");
  } else {
    const res = await client.createConnection({
      provider: node.id,
      name: "default",
      apiKey: ADAPTER_KEY,
      baseUrl: targetAdapterUrl,
    });
    console.log("api-key connection created");
    if (!res.success) console.warn("  warning:", res.error || JSON.stringify(res));
  }

  await syncFreeModels().catch(() => {});
  console.log(
    `\nDone. Models are live in 9Router as:\n  ${workingModels()
      .map((m) => `${PREFIX}/${m}`)
      .join("\n  ")}`,
  );
  console.log("\nCreate a router API key (Dashboard → API Keys) and call /v1 with it.");
}

main().catch((err) => {
  console.error("connect failed:", err.message);
  process.exit(1);
});
