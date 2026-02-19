import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { access, constants } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const execFileAsync = promisify(execFile);

function joinFromRoot(...parts) {
  return path.join(ROOT, ...parts);
}

async function pathExists(pathname) {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBundleAssetSource() {
  const localWebviewDir = joinFromRoot("codex_webview_bundle", "webview");
  const localAssets = path.join(localWebviewDir, "assets");
  const localApps = path.join(localWebviewDir, "apps");

  if ((await pathExists(localAssets)) && (await pathExists(localApps))) {
    return {
      assetsDir: localAssets,
      appsDir: localApps,
      cleanupDir: null
    };
  }

  const archivePath = joinFromRoot("codex-webview-bundle.tar.gz");
  if (!(await pathExists(archivePath))) {
    throw new Error(
      "Missing webview bundle assets. Commit codex_webview_bundle/webview/assets + apps or codex-webview-bundle.tar.gz."
    );
  }

  const extractDir = joinFromRoot(".netlify-bundle-tmp");
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);

  const extractedWebview = path.join(extractDir, "webview");
  const extractedAssets = path.join(extractedWebview, "assets");
  const extractedApps = path.join(extractedWebview, "apps");
  if (!(await pathExists(extractedAssets)) || !(await pathExists(extractedApps))) {
    throw new Error("Bundle archive does not contain webview/assets and webview/apps.");
  }

  return {
    assetsDir: extractedAssets,
    appsDir: extractedApps,
    cleanupDir: extractDir
  };
}

async function copyRequiredFiles() {
  const distWebviewDir = path.join(DIST, "codex_webview_bundle", "webview");
  await cp(
    joinFromRoot("codex_webview_bundle", "webview"),
    distWebviewDir,
    { recursive: true }
  );

  await cp(
    joinFromRoot("codex_webview_bundle", "viewer"),
    path.join(DIST, "codex_webview_bundle", "viewer"),
    { recursive: true }
  );

  const assetSource = await resolveBundleAssetSource();
  await cp(assetSource.assetsDir, path.join(distWebviewDir, "assets"), {
    recursive: true,
    force: true
  });
  await cp(assetSource.appsDir, path.join(distWebviewDir, "apps"), {
    recursive: true,
    force: true
  });

  if (assetSource.cleanupDir) {
    await rm(assetSource.cleanupDir, { recursive: true, force: true });
  }
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

async function assertBundleIntegrity() {
  const webviewDir = path.join(DIST, "codex_webview_bundle", "webview");
  const htmlPath = path.join(webviewDir, "index.html");
  const html = await readFile(htmlPath, "utf8");

  const requiredAssetFiles = [];

  const scriptRe = /src="\/codex_webview_bundle\/webview\/assets\/([^"]+)"/g;
  for (const match of html.matchAll(scriptRe)) {
    requiredAssetFiles.push(match[1]);
  }

  const cssRe = /href="\/codex_webview_bundle\/webview\/assets\/([^"]+)"/g;
  for (const match of html.matchAll(cssRe)) {
    requiredAssetFiles.push(match[1]);
  }

  for (const fileName of requiredAssetFiles) {
    const assetPath = path.join(webviewDir, "assets", fileName);
    if (!(await pathExists(assetPath))) {
      throw new Error(`Missing required webview asset in dist: ${fileName}`);
    }
  }
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyRequiredFiles();
  await writeDistIndex();
  await assertBundleIntegrity();
  console.log("Netlify build complete: dist/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
