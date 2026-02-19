import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

async function copyRequiredFiles() {
  await cp(
    path.join(ROOT, "codex_webview_bundle", "webview"),
    path.join(DIST, "codex_webview_bundle", "webview"),
    { recursive: true }
  );

  await cp(
    path.join(ROOT, "codex_webview_bundle", "viewer"),
    path.join(DIST, "codex_webview_bundle", "viewer"),
    { recursive: true }
  );
}

async function writeDistIndex() {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Transcript Viewer</title>
    <meta http-equiv="refresh" content="0; url=/codex_webview_bundle/webview/index.html" />
  </head>
  <body>
    <p>Redirecting to viewer...</p>
  </body>
</html>
`;

  await writeFile(path.join(DIST, "index.html"), html, "utf8");
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyRequiredFiles();
  await writeDistIndex();
  console.log("Netlify build complete: dist/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
