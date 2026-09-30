/*
 * The dev server the owner plays on.
 *
 * It was `python3 -m http.server` until 2026-09-30, which sends no cache
 * headers at all: a browser that already had the page open kept running the
 * *previous* build's scripts after a plain reload, and that cost a whole round
 * of 「还是被打断了」 / 「没有打死怪物就不喷血」 on a 霸体 fix that was already in
 * the file. Every response here says `no-store`, so a reload is always the
 * build that is on disk.
 *
 *   npm run serve        ->  http://localhost:8080
 *   PORT=9000 npm run serve
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8080);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".ico": "image/x-icon"
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`nano-dnf on http://localhost:${PORT} (no-store)`));
