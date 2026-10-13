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

/*
 * **音乐清单**：`assets/music/manifest.json` 说"哪几首真的在"。
 *
 * 为什么不让游戏自己去试一把：试一个不存在的文件，控制台就会留下一条 404，而浏览器
 * 证明里"控制台无报错"是一条硬门（`tests/browser/playability.mjs`）。清单文件本身
 * 一定在，所以读它不会有任何一条失败请求 —— 只有它列出来的那几首才会被真的去取。
 *
 * 那两首是要业主从客户端 `Music\` 拷过来的（`assets/music/README.md`），所以每次
 * `npm run serve` 都按目录里的实际文件重写一遍：**放好之后跑一次 serve 就同步了**。
 */
function syncMusicManifest() {
  const dir = path.join(ROOT, "assets", "music");
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".ogg"))
      .sort();
  } catch (error) {
    files = [];
  }
  const body =
    JSON.stringify(
      {
        note: "由 `npm run serve` 按 assets/music/ 里实际的 .ogg 重写 —— 别手改。",
        files: files
      },
      null,
      2
    ) + "\n";
  const target = path.join(dir, "manifest.json");
  try {
    if (fs.readFileSync(target, "utf8") !== body) fs.writeFileSync(target, body);
  } catch (error) {
    /* 目录还不存在就不写；游戏读不到清单就当作一首都没有。 */
  }
  if (files.length) console.log(`music: ${files.join(", ")}`);
}

syncMusicManifest();

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
