import { join, normalize } from "node:path";
import { loadConfig } from "./config.ts";
import { listDays, readDay, readSummary } from "./store.ts";

const cfg = loadConfig();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function serveFile(path: string, fallbackStatus = 404): Promise<Response> {
  const file = Bun.file(path);
  if (await file.exists()) return new Response(file);
  return new Response("Not found", { status: fallbackStatus });
}

const server = Bun.serve({
  port: cfg.port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === "/favicon.ico") {
      // Inline emoji favicon so the browser stops 404-ing.
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🖥️</text></svg>';
      return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
    }

    if (path === "/" || path === "/index.html") {
      return serveFile(join(cfg.webDir, "index.html"));
    }
    if (path === "/app.js") return serveFile(join(cfg.webDir, "app.js"));
    if (path === "/style.css") return serveFile(join(cfg.webDir, "style.css"));

    if (path === "/api/days") {
      return jsonResponse(await listDays(cfg));
    }

    const dayMatch = path.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (dayMatch) {
      const day = dayMatch[1]!;
      const [entries, summary] = await Promise.all([readDay(cfg, day), readSummary(cfg, day)]);
      return jsonResponse({ day, entries, summary });
    }

    if (path.startsWith("/screenshots/")) {
      // Prevent path traversal: resolve within screenshotsDir only.
      const rel = normalize(path.slice("/screenshots/".length));
      if (rel.startsWith("..") || rel.includes("/../")) {
        return new Response("Forbidden", { status: 403 });
      }
      return serveFile(join(cfg.screenshotsDir, rel));
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`[memdesk] timeline UI → http://localhost:${server.port}`);
