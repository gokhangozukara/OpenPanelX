import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = mkdtempSync(path.join(os.tmpdir(), "openpanelx-smoke-"));

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    OPENPANELX_DATA: tempDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (d) => {
  logs += d.toString();
});
child.stderr.on("data", (d) => {
  logs += d.toString();
});

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}\n${logs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return res;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health\n${logs}`);
}

function extractScriptNonce(csp) {
  const parts = csp.split(";").map((part) => part.trim());
  const scriptSrc = parts.find((part) => part.startsWith("script-src "));
  assert.ok(scriptSrc, `Missing script-src directive in CSP: ${csp}`);
  assert.equal(scriptSrc.includes("'unsafe-inline'"), false, `script-src must not allow unsafe-inline: ${scriptSrc}`);
  assert.ok(scriptSrc.includes("'strict-dynamic'"), `script-src must include strict-dynamic: ${scriptSrc}`);
  const match = scriptSrc.match(/'nonce-([^']+)'/);
  assert.ok(match && match[1], `Missing nonce in script-src: ${scriptSrc}`);

  const styleSrc = parts.find((part) => part.startsWith("style-src "));
  assert.ok(styleSrc, `Missing style-src directive in CSP: ${csp}`);
  assert.equal(styleSrc.includes("'unsafe-inline'"), false, `style-src must not allow unsafe-inline in production: ${styleSrc}`);
  assert.ok(styleSrc.includes(`'nonce-${match[1]}'`), `style-src must carry the same nonce: ${styleSrc}`);

  return match[1];
}

try {
  const healthRes = await waitForHealth();
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.name, "OpenPanelX");
  assert.equal(health.version, "0.4.3");

  const csp1 = healthRes.headers.get("content-security-policy") ?? "";
  assert.ok(csp1.includes("default-src 'self'"), `Missing CSP header: ${csp1}`);
  assert.ok(csp1.includes("frame-ancestors 'none'"), `Missing frame-ancestors in CSP: ${csp1}`);
  const nonce1 = extractScriptNonce(csp1);

  const healthRes2 = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes2.status, 200);
  const nonce2 = extractScriptNonce(healthRes2.headers.get("content-security-policy") ?? "");
  assert.notEqual(nonce1, nonce2, "CSP nonce must rotate on every request");

  const hsts = healthRes.headers.get("strict-transport-security") ?? "";
  assert.ok(hsts.includes("max-age=31536000"), `Missing HSTS header: ${hsts}`);
  assert.equal(healthRes.headers.get("x-frame-options"), "DENY");
  assert.equal(healthRes.headers.get("x-content-type-options"), "nosniff");
  assert.equal(healthRes.headers.get("referrer-policy"), "strict-origin-when-cross-origin");

  const unauthPlugins = await fetch(`${baseUrl}/api/plugins`);
  assert.equal(unauthPlugins.status, 401);

  const unauthPost = await fetch(`${baseUrl}/api/plugins/notes/tables/0`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Should fail" }),
  });
  assert.equal(unauthPost.status, 401);

  console.log("Smoke test passed.");
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  rmSync(tempDir, { recursive: true, force: true });
}
