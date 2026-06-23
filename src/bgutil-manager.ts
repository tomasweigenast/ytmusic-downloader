import { join } from "path";
import type { Logger } from "./utils.ts";

const BGUTIL_PORT = 4416;
const BGUTIL_URL = `http://127.0.0.1:${BGUTIL_PORT}`;
const SERVER_DIR = join(import.meta.dir, "..", "bgutil-server");
const SERVER_ENTRY = join(SERVER_DIR, "build", "main.js");

async function isPotServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BGUTIL_URL}/ping`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPotServerRunning()) return true;
    await Bun.sleep(500);
  }
  return false;
}

export interface BgutilServer {
  stop: () => void;
}

export async function startBgutilServer(logger: Logger): Promise<BgutilServer | null> {
  if (await isPotServerRunning()) {
    logger.debug("POT server already running, reusing");
    return { stop: () => {} };
  }

  const serverEntry = Bun.file(SERVER_ENTRY);
  if (!(await serverEntry.exists())) {
    logger.warn(`bgutil server not built. Run: cd bgutil-server && npm ci && npx tsc`);
    return null;
  }

  logger.debug("Starting bgutil POT server…");
  const proc = Bun.spawn(["node", SERVER_ENTRY], {
    stdout: "ignore",
    stderr: "ignore",
    cwd: SERVER_DIR,
  });

  const ready = await waitForServer();
  if (!ready) {
    proc.kill();
    logger.warn("bgutil POT server failed to start within 15s, continuing without PO tokens");
    return null;
  }

  logger.debug(`bgutil POT server running on port ${BGUTIL_PORT}`);
  return {
    stop: () => {
      proc.kill();
      logger.debug("bgutil POT server stopped");
    },
  };
}
