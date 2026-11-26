import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "openpanelx-e2e-"));
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "start", "-p", "3198", "-H", "127.0.0.1"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    OPENPANELX_DATA: tempDir,
    OPENPANELX_INSECURE: "1",
  },
  stdio: "inherit",
});

function cleanup() {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}

function forwardSignal(signal) {
  if (child.exitCode === null) child.kill(signal);
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
