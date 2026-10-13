#!/usr/bin/env node
/**
 * connect-9router.js
 * ---------------------------------------------------------------------------
 * Registers the OpenCode free adapter inside 9Router as a custom
 * OpenAI-compatible provider node, connects API credentials, and synchronizes
 * all available models to 9Router's custom models catalog (like llm-harvester).
 *
 * Supports:
 *   - Local 9Router (via global npm client or local CLI token)
 *   - Docker-deployed 9Router (auto-detects container, retrieves token, resolves bridge URL)
 *   - Remote 9Router (via NINEROUTER_CLI_TOKEN)
 *
 * Zero dependencies.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
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

/** Try to derive the CLI token directly from local ~/.9router files. */
function findLocalCliToken() {
  const dirs = [
    path.join(os.homedir(), ".9router"),
    "/root/.9router",
    "/home/node/.9router",
  ];
  for (const d of dirs) {
    try {
      const mid = readFileSync(path.join(d, "machine-id"), "utf8").trim();
      const sec = readFileSync(path.join(d, "auth/cli-secret"), "utf8").trim();
      if (mid && sec) {
        return crypto.createHash("sha256").update(mid + "9r-cli-auth" + sec).digest("hex").slice(0, 16);
      }
    } catch {}
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
    const token = execSync(`docker exec ${containerName} node -e "${script.replace(/\\n\\s*/g, ' ')}"`, {
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
  const bridgeUrl = adapterUrl.replace(/127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0/, "172.17.0.1");
  try {
    const healthUrl = bridgeUrl.replace(/\/v1\/?$/, testPath);
    execSync(`docker exec ${containerName} node -e "fetch('${healthUrl}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`, {
      stdio: "ignore",
    });
    return bridgeUrl;
  } catch {}

  // 3. Check host.docker.internal
  const hostDockerUrl = adapterUrl.replace(/127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0/, "host.docker.internal");
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
      "no 9Router token found and NINEROUTER_CLI_TOKEN is not set; ensure 9Router is running or export the token",
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
  const token = process.env.NINEROUTER_CLI_TOKEN || dockerToken || findLocalCliToken();
  const clientPath = findRouterClient();

  const kind = dockerToken
    ? `raw HTTP (auto-authenticated from Docker container "${dockerContainer}")`
    : clientPath
      ? `9router client (${clientPath}) + HTTP`
      : token
        ? "raw HTTP (CLI token)"
        : "raw HTTP";

  let api = null;
  if (clientPath) {
    try {
      api = require(clientPath);
    } catch {}
  }

  return {
    kind,
    token,
    async listNodes() {
      if (api?.getProviderNodes) {
        const r = await api.getProviderNodes();
        return r.data?.nodes || r.nodes || [];
      }
      const r = await rawRequest("GET", "/api/provider-nodes", null, token);
      return r.data?.nodes || r.nodes || [];
    },
    async createNode(body) {
      if (api?.createProviderNode) return api.createProviderNode(body);
      return rawRequest("POST", "/api/provider-nodes", body, token);
    },
    async updateNode(id, body) {
      if (api?.updateProviderNode) return api.updateProviderNode(id, body);
      return rawRequest("PUT", `/api/provider-nodes/${id}`, body, token);
    },
    async listProviders() {
      if (api?.getProviders) {
        const r = await api.getProviders();
        return r.data?.connections || r.connections || [];
      }
      const r = await rawRequest("GET", "/api/providers", null, token);
      return r.data?.connections || r.connections || r.providers || r.data || [];
    },
    async createConnection(body) {
      if (api?.createApiKeyProvider) return api.createApiKeyProvider(body);
      return rawRequest("POST", "/api/providers", body, token);
    },
    async updateConnection(id, body) {
      if (api?.updateConnection) return api.updateConnection(id, body);
      return rawRequest("PUT", `/api/providers/${id}`, body, token);
    },
    async listCustomModels() {
      const r = await rawRequest("GET", "/api/models/custom", null, token);
      return r.models || r.data?.models || [];
    },
    async addCustomModel(nodeId, modelId, name) {
      return rawRequest(
        "POST",
        "/api/models/custom",
        {
          providerAlias: nodeId,
          id: modelId,
          type: "llm",
          name: name || modelId,
        },
        token,
      );
    },
    async deleteCustomModel(nodeId, modelId) {
      return rawRequest(
        "DELETE",
        `/api/models/custom?providerAlias=${encodeURIComponent(nodeId)}&id=${encodeURIComponent(modelId)}&type=llm`,
        null,
        token,
      );
    },
  };
}

/** Sync models into 9Router custom models catalog (matching llm-harvester pattern). */
async function syncModelsToRouter(client, nodeId, models) {
  try {
    const customModels = await client.listCustomModels();
    const existingForNode = new Set(
      customModels
        .filter((m) => m.providerAlias === nodeId)
        .map((m) => m.id),
    );

    const targetSet = new Set(models);
    let added = 0;
    let pruned = 0;

    for (const model of models) {
      if (!existingForNode.has(model)) {
        await client.addCustomModel(nodeId, model, model);
        added++;
      }
    }

    for (const existingId of existingForNode) {
      if (!targetSet.has(existingId)) {
        await client.deleteCustomModel(nodeId, existingId);
        pruned++;
      }
    }

    if (added > 0 || pruned > 0) {
      console.log(`models     : synced to 9Router (+${added} added, -${pruned} pruned)`);
    } else {
      console.log(`models     : all ${models.length} models up to date in 9Router`);
    }
  } catch (err) {
    console.warn(`warning    : failed to sync models to 9Router (${err.message})`);
  }
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
  const connections = await client.listProviders();
  const existingConn = connections.find(
    (c) => c.provider === node.id || c.providerId === node.id,
  );

  const connPayload = {
    provider: node.id,
    name: "default",
    apiKey: ADAPTER_KEY,
    baseUrl: targetAdapterUrl,
    isActive: true,
    providerSpecificData: {
      baseUrl: targetAdapterUrl,
      prefix: PREFIX,
      apiType: "chat",
      nodeName: NAME,
    },
  };

  if (existingConn) {
    if (process.env.SKIP_CONNECTION === "1") {
      console.log("connection : skipped (SKIP_CONNECTION=1)");
    } else {
      try {
        await client.updateConnection(existingConn.id, connPayload);
        console.log(`connection : refreshed connection settings (${existingConn.id})`);
      } catch {
        console.log(`connection : already present (${existingConn.id})`);
      }
    }
  } else {
    const res = await client.createConnection(connPayload);
    console.log("connection : created api-key connection");
    if (!res.success && res.error) console.warn("  warning:", res.error);
  }

  // 3. sync models into 9Router custom models catalog (like llm-harvester)
  await syncFreeModels().catch(() => {});
  const models = workingModels();
  await syncModelsToRouter(client, node.id, models);

  console.log(
    `\nDone. Models are live in 9Router as:\n  ${models
      .map((m) => `${PREFIX}/${m}`)
      .join("\n  ")}`,
  );
  console.log("\nCreate a router API key (Dashboard → API Keys) and call /v1 with it.");
}

main().catch((err) => {
  console.error("connect failed:", err.message);
  process.exit(1);
});
