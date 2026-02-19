import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT || 31340);
const ROOT_DIR = process.cwd();
const DEFAULT_ENTRY = "/codex_webview_bundle/webview/index.html";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"]
]);

function resolveRequestPath(rawPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  const absolutePath = path.resolve(ROOT_DIR, `.${pathname}`);
  const rootWithSep = `${ROOT_DIR}${path.sep}`;
  const withinRoot =
    absolutePath === ROOT_DIR || absolutePath.startsWith(rootWithSep);
  if (!withinRoot) {
    return null;
  }
  return absolutePath;
}

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/") {
    const location = `${DEFAULT_ENTRY}${requestUrl.search}`;
    send(
      res,
      302,
      {
        location,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache"
      },
      `Redirecting to ${location}`
    );
    return;
  }

  const absolutePath = resolveRequestPath(requestUrl.pathname);
  if (!absolutePath) {
    send(
      res,
      403,
      { "content-type": "text/plain; charset=utf-8" },
      "Forbidden"
    );
    return;
  }

  let filePath = absolutePath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    send(
      res,
      404,
      { "content-type": "text/plain; charset=utf-8" },
      "Not Found"
    );
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      MIME_TYPES.get(ext) || "application/octet-stream; charset=utf-8";
    send(
      res,
      200,
      {
        "content-type": contentType,
        "cache-control": "no-cache"
      },
      body
    );
  } catch {
    send(
      res,
      404,
      { "content-type": "text/plain; charset=utf-8" },
      "Not Found"
    );
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    send(
      res,
      500,
      { "content-type": "text/plain; charset=utf-8" },
      `Internal Server Error\n${message}`
    );
  });
});

server.listen(PORT, () => {
  console.log(`Codex transcript viewer server running on http://localhost:${PORT}`);
  console.log(`Serving from: ${ROOT_DIR}`);
});
