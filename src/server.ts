import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createInternalAdapter } from "./adapters/internal.js";
import { createZhongdengAdapter } from "./adapters/zhongdeng.js";
import { RiskCheckService } from "./core/service.js";
import type { CreateRiskCheckInput } from "./core/types.js";
import { FileStore } from "./storage/file-store.js";

const port = Number(process.env.PORT || 8787);
const store = new FileStore();
await store.init();
const zhongdengAdapter = createZhongdengAdapter();
const internalAdapter = createInternalAdapter();
const service = new RiskCheckService(store, zhongdengAdapter, internalAdapter);

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(currentDir, process.env.NODE_ENV === "production" ? "../../public" : "../public");
const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length; if (size > 1_000_000) throw new Error("Request body too large"); chunks.push(buf);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as T : {} as T;
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) return false;
  try {
    const info = await stat(filePath); if (!info.isFile()) return false;
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(filePath)); return true;
  } catch { return false; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, zhongdengAdapter: zhongdengAdapter.mode, internalAdapter: internalAdapter.mode, timestamp: new Date().toISOString() });
    if (req.method === "GET" && url.pathname === "/api/config") return sendJson(res, 200, { zhongdengAdapter: zhongdengAdapter.mode, internalAdapter: internalAdapter.mode, manualCaptcha: zhongdengAdapter.mode === "browser" });
    if (req.method === "GET" && url.pathname === "/api/checks") return sendJson(res, 200, { data: await service.list() });
    if (req.method === "POST" && url.pathname === "/api/checks") {
      const input = await readJson<CreateRiskCheckInput>(req);
      return sendJson(res, 202, { data: await service.create(input, String(req.headers["x-actor"] || "poc-user")) });
    }
    const match = url.pathname.match(/^\/api\/checks\/([0-9a-f-]+)$/i);
    if (req.method === "GET" && match?.[1]) {
      const job = await service.get(match[1]);
      return job ? sendJson(res, 200, { data: job }) : sendJson(res, 404, { error: "not_found" });
    }
    if (req.method === "GET" && await serveStatic(url.pathname, res)) return;
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Zhongdeng risk check POC: http://localhost:${port}`);
  console.log(`Adapters: zhongdeng=${zhongdengAdapter.mode}, internal=${internalAdapter.mode}`);
});

async function shutdown() {
  await zhongdengAdapter.close?.().catch(() => undefined);
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
