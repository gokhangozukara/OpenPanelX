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

try {
  const healthRes = await waitForHealth();
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.name, "OpenPanelX");
  assert.equal(health.version, "0.4.1");

  const csp = healthRes.headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes("default-src 'self'"), `Missing CSP header: ${csp}`);
  assert.ok(csp.includes("frame-ancestors 'none'"), `Missing frame-ancestors in CSP: ${csp}`);
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
