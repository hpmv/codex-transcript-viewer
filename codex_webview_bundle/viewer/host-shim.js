import { parseJsonlTranscript } from "./transcript-parser.js";
import { buildThreadRuntimeState } from "./replay-converter.js";
import { RpcAdapter } from "./rpc-adapter.js";
import { FetchAdapter, READONLY_MESSAGE } from "./fetch-adapter.js";
import { createHostBridge } from "./host-bridge.js";

const TOAST_DURATION_MS = 3200;

let ui = null;
const pendingToasts = [];

function applyWebviewStyleDefaults() {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  if (!root.dataset.codexWindowType) {
    root.dataset.codexWindowType = "browser";
  }

  if (!root.classList.contains("dark") && !root.classList.contains("light")) {
    root.classList.add("dark");
  }

  const defaults = {
    "--vscode-editor-background": "#0f1115",
    "--vscode-editor-foreground": "#e6edf3",
    "--vscode-foreground": "#e6edf3",
    "--vscode-sideBar-background": "#0f1115",
    "--vscode-menu-background": "#171b22",
    "--vscode-dropdown-background": "#171b22",
    "--vscode-input-background": "#0c1118",
    "--vscode-input-foreground": "#e6edf3",
    "--vscode-textCodeBlock-background": "#161b22",
    "--vscode-button-background": "#2f81f7",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-button-secondaryHoverBackground": "#30363d",
    "--vscode-list-hoverBackground": "#262c36",
    "--vscode-toolbar-hoverBackground": "#262c36",
    "--vscode-scrollbarSlider-background": "#ffffff2a",
    "--vscode-scrollbarSlider-hoverBackground": "#ffffff40",
    "--vscode-scrollbarSlider-activeBackground": "#ffffff55",
    "--vscode-focusBorder": "#2f81f7",
    "--vscode-textLink-foreground": "#58a6ff",
    "--vscode-textLink-activeForeground": "#79c0ff",
    "--vscode-font-family":
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    "--vscode-font-size": "13px",
    "--vscode-editor-font-family":
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    "--vscode-editor-font-size": "12px",
    "--vscode-editor-font-weight": "400",
    "--vscode-chat-font-size": "13px",
    "--vscode-chat-editor-font-size": "12px",
    "--vscode-charts-yellow": "#d29922",
    "--vscode-charts-orange": "#db6d28"
  };

  const style = root.style;
  for (const [key, value] of Object.entries(defaults)) {
    if (!style.getPropertyValue(key)) {
      style.setProperty(key, value);
    }
  }

  if (!style.getPropertyValue("color-scheme")) {
    style.setProperty("color-scheme", "dark");
  }

  if (document.body) {
    document.body.style.backgroundColor =
      "var(--vscode-editor-background, #0f1115)";
    document.body.style.color = "var(--vscode-editor-foreground, #e6edf3)";
    document.body.style.colorScheme = "dark";
  }
}

function notifyReadonly(message) {
  const text = String(message || READONLY_MESSAGE);
  if (ui) {
    ui.showToast(text);
    return;
  }
  pendingToasts.push(text);
}

const rpcAdapter = new RpcAdapter();
const fetchAdapter = new FetchAdapter({ onReadonlyAction: notifyReadonly });
const bridge = createHostBridge({
  rpcAdapter,
  fetchAdapter,
  onReadonlyAction: notifyReadonly,
  onHostLog: ({ type, message }) => {
    if (type !== "log-message") {
      return;
    }

    const level =
      typeof message?.level === "string" ? message.level.toLowerCase() : "debug";
    const text =
      typeof message?.message === "string"
        ? message.message
        : JSON.stringify(message ?? {});
    const payload =
      message && typeof message === "object" ? message : { message: text };

    if (level === "error") {
      console.error("[codex-host]", text, payload);
      return;
    }
    if (level === "warning") {
      console.warn("[codex-host]", text, payload);
      return;
    }
    if (level === "info") {
      console.info("[codex-host]", text, payload);
      return;
    }
    console.debug("[codex-host]", text, payload);
  }
});

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (typeof text === "string") {
    element.textContent = text;
  }
  return element;
}

function installStyles() {
  const style = document.createElement("style");
  style.id = "ctv-host-shim-style";
  style.textContent = `
html,
body {
  margin: 0;
  padding: 0;
  background-color: var(--vscode-editor-background, #0f1115) !important;
  color: var(--vscode-editor-foreground, #e6edf3);
  color-scheme: dark;
}

#root {
  min-height: 100vh;
  background-color: var(--vscode-editor-background, #0f1115);
}

#ctv-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 12, 22, 0.6);
  backdrop-filter: blur(2px);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

#ctv-overlay[hidden] {
  display: none;
}

#ctv-panel {
  width: min(680px, calc(100vw - 32px));
  border: 1px solid #2c3748;
  border-radius: 14px;
  background: #111722;
  color: #e9edf5;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.45);
  padding: 22px;
}

#ctv-panel h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

#ctv-panel p {
  margin: 10px 0 0;
  color: #b7c0cf;
  line-height: 1.4;
  font-size: 13px;
}

#ctv-controls {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

#ctv-pick-btn,
#ctv-launcher {
  border: 1px solid #3958a9;
  border-radius: 10px;
  background: #2d4f9b;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 9px 14px;
}

#ctv-launcher {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 2147483644;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

#ctv-launcher[hidden] {
  display: none;
}

#ctv-drop-zone {
  margin-top: 14px;
  border: 1px dashed #3a4659;
  border-radius: 12px;
  padding: 18px;
  text-align: center;
  color: #94a0b7;
  font-size: 13px;
  transition: border-color 120ms ease, background-color 120ms ease;
}

#ctv-drop-zone.ctv-active {
  border-color: #6994ff;
  background: rgba(79, 126, 255, 0.13);
  color: #d4e2ff;
}

#ctv-status {
  min-height: 20px;
  margin-top: 12px;
  color: #b7c0cf;
  font-size: 12px;
}

#ctv-status.ctv-error {
  color: #ff8a8a;
}

#ctv-status.ctv-warn {
  color: #ffd48a;
}

#ctv-banner {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 2147483644;
  border: 1px solid #3e4c63;
  border-radius: 10px;
  background: rgba(16, 24, 36, 0.95);
  color: #d3dcee;
  font-size: 12px;
  line-height: 1.35;
  padding: 8px 10px;
  max-width: min(70vw, 740px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

#ctv-banner[hidden] {
  display: none;
}

#ctv-banner .ctv-note {
  display: inline-block;
  margin-left: 8px;
  color: #ffd48a;
}

#ctv-toast-stack {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 2147483645;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: min(500px, calc(100vw - 24px));
}

#ctv-toast-stack .ctv-toast {
  border: 1px solid #3f5068;
  border-radius: 10px;
  background: rgba(18, 25, 37, 0.96);
  color: #dce4f2;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.3);
}

@media (max-width: 640px) {
  #ctv-panel {
    width: calc(100vw - 20px);
    padding: 16px;
  }

  #ctv-banner {
    max-width: calc(100vw - 24px);
  }
}
`;
  document.head.appendChild(style);
}

function createUi(onFileSelected) {
  installStyles();

  const overlay = createElement("div");
  overlay.id = "ctv-overlay";

  const panel = createElement("div");
  panel.id = "ctv-panel";

  const title = createElement("h1", "", "Codex Transcript Viewer");
  const subtitle = createElement(
    "p",
    "",
    "Load a Codex session transcript (.jsonl). Rendering is readonly and matches the VS Code Codex UI."
  );

  const controls = createElement("div");
  controls.id = "ctv-controls";

  const pickBtn = createElement("button", "", "Choose JSONL");
  pickBtn.id = "ctv-pick-btn";
  pickBtn.type = "button";

  const input = createElement("input");
  input.type = "file";
  input.accept = ".jsonl,application/jsonl";
  input.hidden = true;

  const dropZone = createElement("div", "", "Drop a .jsonl transcript here");
  dropZone.id = "ctv-drop-zone";

  const status = createElement("div");
  status.id = "ctv-status";

  const banner = createElement("div");
  banner.id = "ctv-banner";
  banner.hidden = true;

  const launcher = createElement("button", "", "Load another file");
  launcher.id = "ctv-launcher";
  launcher.type = "button";
  launcher.hidden = true;

  const toastStack = createElement("div");
  toastStack.id = "ctv-toast-stack";

  controls.appendChild(pickBtn);

  panel.appendChild(title);
  panel.appendChild(subtitle);
  panel.appendChild(controls);
  panel.appendChild(dropZone);
  panel.appendChild(status);

  overlay.appendChild(panel);

  document.body.appendChild(overlay);
  document.body.appendChild(input);
  document.body.appendChild(banner);
  document.body.appendChild(launcher);
  document.body.appendChild(toastStack);

  function clearStatus() {
    status.textContent = "";
    status.className = "";
    status.id = "ctv-status";
  }

  function setInfo(message) {
    status.textContent = message || "";
    status.className = "";
    status.id = "ctv-status";
  }

  function setError(message) {
    status.textContent = message || "";
    status.className = "ctv-error";
    status.id = "ctv-status";
  }

  function setWarning(message) {
    status.textContent = message || "";
    status.className = "ctv-warn";
    status.id = "ctv-status";
  }

  function setLoadedBanner(summary) {
    banner.textContent = summary.text || "";
    if (summary.note) {
      const note = createElement("span", "ctv-note", summary.note);
      banner.appendChild(note);
    }
    banner.hidden = false;
    launcher.hidden = false;
  }

  function showOverlay() {
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function openPicker() {
    input.value = "";
    input.click();
  }

  function showToast(message) {
    const toast = createElement("div", "ctv-toast", message);
    toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, TOAST_DURATION_MS);
  }

  function setDropActive(active) {
    if (active) {
      dropZone.classList.add("ctv-active");
      return;
    }
    dropZone.classList.remove("ctv-active");
  }

  pickBtn.addEventListener("click", openPicker);
  launcher.addEventListener("click", openPicker);

  input.addEventListener("change", async (event) => {
    const file = event.target?.files?.[0];
    if (file) {
      await onFileSelected(file);
    }
  });

  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      prevent(event);
      setDropActive(true);
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      prevent(event);
      if (type === "drop") {
        const file = event.dataTransfer?.files?.[0];
        if (file) {
          onFileSelected(file);
        }
      }
      setDropActive(false);
    });
  });

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  });

  return {
    clearStatus,
    setInfo,
    setError,
    setWarning,
    setLoadedBanner,
    showOverlay,
    hideOverlay,
    showToast
  };
}

function formatBanner(runtimeState, parsedTranscript, fileName) {
  const nonEmpty = Number(parsedTranscript?.nonEmptyLines || 0);
  const turnCount = Number(runtimeState?.meta?.turnCount || 0);
  const itemCount = Number(runtimeState?.meta?.itemCount || 0);

  const parts = [
    "Readonly transcript mode",
    fileName || "(unknown file)",
    `${nonEmpty} lines`,
    `${turnCount} turns`,
    `${itemCount} items`
  ];

  let note = "";
  if (runtimeState?.meta?.fallbackUsed) {
    note = "Limited transcript: fallback rendering from response items";
  } else if (turnCount === 0) {
    note = "No renderable turns found";
  }

  return {
    text: parts.join(" · "),
    note
  };
}

async function loadTranscriptFile(file) {
  if (!ui) {
    return;
  }

  ui.clearStatus();
  if (!file.name.toLowerCase().endsWith(".jsonl")) {
    ui.setWarning(`Parsing ${file.name} (non-.jsonl extension)...`);
  } else {
    ui.setInfo(`Parsing ${file.name}...`);
  }

  try {
    const text = await file.text();
    const parsed = parseJsonlTranscript(text);
    const runtimeState = buildThreadRuntimeState(parsed, { filename: file.name });

    bridge.setRuntimeState(runtimeState);
    bridge.emitThreadLoaded();

    ui.hideOverlay();
    ui.setLoadedBanner(formatBanner(runtimeState, parsed, file.name));

    if (runtimeState.meta?.fallbackUsed) {
      ui.showToast(
        "Loaded with fallback rendering because event stream had no renderable turns."
      );
    }

    if ((runtimeState.meta?.turnCount || 0) === 0) {
      ui.showToast("Loaded transcript has no renderable turns.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ui.showOverlay();
    ui.setError(message);
  }
}

function initUi() {
  applyWebviewStyleDefaults();

  if (document.body && !document.body.dataset.codexWindowType) {
    document.body.dataset.codexWindowType =
      document.documentElement?.dataset.codexWindowType || "browser";
  }

  ui = createUi(loadTranscriptFile);

  while (pendingToasts.length > 0) {
    const next = pendingToasts.shift();
    if (next) {
      ui.showToast(next);
    }
  }

  ui.setInfo("Choose a .jsonl file or drag and drop one here.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUi, { once: true });
} else {
  initUi();
}
