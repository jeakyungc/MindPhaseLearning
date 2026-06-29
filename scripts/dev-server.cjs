const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");
const { URL } = require("url");

const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const reloadPath = "/__hot_reload";
const analyzerScript = path.join(rootDir, "scripts", "analyze-mindphase.cjs");
const generatedGraphPath = path.join(rootDir, "generated", "mindphase-codebase-graph.json");
const clients = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8"
};

const reloadClientScript = `
<script>
(() => {
  const source = new EventSource("${reloadPath}");
  source.addEventListener("reload", () => window.location.reload());
  source.onerror = () => {
    source.close();
    setTimeout(() => window.location.reload(), 1000);
  };
})();
</script>`;

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function isInsideRoot(filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRequestPath(reqUrl) {
  const url = new URL(reqUrl, `http://${host}:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  return path.resolve(rootDir, `.${normalizedPath}`);
}

function serveFile(req, res) {
  const filePath = resolveRequestPath(req.url);

  if (!isInsideRoot(filePath)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        send(res, 500, "Internal server error", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }

      if (extension === ".html") {
        const html = data.toString("utf8");
        const body = html.includes("</body>")
          ? html.replace("</body>", `${reloadClientScript}\n</body>`)
          : `${html}${reloadClientScript}`;
        send(res, 200, body, {
          "Content-Type": contentType,
          "Cache-Control": "no-store"
        });
        return;
      }

      send(res, 200, data, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      });
    });
  });
}

function handleReloadStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write("event: connected\ndata: ok\n\n");

  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function broadcastReload() {
  for (const client of clients) {
    client.write("event: reload\ndata: changed\n\n");
  }
}

let reloadTimer;
function queueReload(fileName) {
  const changedPath = fileName ? path.resolve(rootDir, fileName.toString()) : "";
  const ignoredParts = [
    `${path.sep}.git${path.sep}`,
    `${path.sep}node_modules${path.sep}`,
    "browser-verify-server.out.log",
    "browser-verify-server.err.log"
  ];

  if (ignoredParts.some((part) => changedPath.includes(part) || changedPath.endsWith(part))) {
    return;
  }

  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`[dev] reload ${fileName || ""}`.trim());
    broadcastReload();
  }, 100);
}

function watchFiles() {
  try {
    fs.watch(rootDir, { recursive: true }, (_eventType, fileName) => queueReload(fileName));
  } catch (error) {
    console.warn(`[dev] recursive watch unavailable: ${error.message}`);
    fs.watch(rootDir, (_eventType, fileName) => queueReload(fileName));
  }
}

let analysisTimer;
let analysisRunning = false;
function runAnalysis(reason) {
  if (analysisRunning) return;
  analysisRunning = true;
  console.log(`[dev] analyze ${reason}`);
  const result = spawnSync(process.execPath, [analyzerScript], {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
  });
  analysisRunning = false;

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.warn(`[dev] analysis failed with exit code ${result.status}`);
  }
}

function queueAnalysis(fileName) {
  const text = fileName ? fileName.toString() : "";
  if (text && !/\.(ts|svelte|js|mjs|rs|toml|json)$/.test(text)) return;
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => runAnalysis(text || "source change"), 300);
}

function sourceWatchRoot() {
  if (process.env.MINDPHASE_SOURCE) return path.resolve(process.env.MINDPHASE_SOURCE);
  const generated = safeReadJson(generatedGraphPath);
  return generated?.metadata?.sourceRoot || null;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function watchMindPhaseSource() {
  const sourceRoot = sourceWatchRoot();
  if (!sourceRoot || !fs.existsSync(sourceRoot)) return;
  const watchTargets = [
    path.join(sourceRoot, "src"),
    path.join(sourceRoot, "src-tauri", "src"),
    path.join(sourceRoot, "package.json"),
    path.join(sourceRoot, "src-tauri", "Cargo.toml"),
  ].filter((target) => fs.existsSync(target));

  for (const target of watchTargets) {
    try {
      const stats = fs.statSync(target);
      fs.watch(target, { recursive: stats.isDirectory() }, (_eventType, fileName) => queueAnalysis(fileName));
    } catch (error) {
      console.warn(`[dev] source watch unavailable for ${target}: ${error.message}`);
    }
  }
  console.log(`[dev] watching MindPhase source ${sourceRoot}`);
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith(reloadPath)) {
    handleReloadStream(req, res);
    return;
  }

  serveFile(req, res);
});

runAnalysis("startup");

server.listen(port, host, () => {
  watchFiles();
  watchMindPhaseSource();
  console.log(`[dev] serving ${rootDir}`);
  console.log(`[dev] open http://${host}:${port}`);
});
