const READONLY_MESSAGE = "Readonly transcript viewer";
const DEFAULT_LOCALE = "en-US";

const MUTATING_FETCH_METHODS = new Set([
  "apply-patch",
  "automation-create",
  "automation-delete",
  "automation-run-archive",
  "automation-run-delete",
  "automation-run-now",
  "automation-update",
  "feedback-create-sentry-issue",
  "generate-pull-request-message",
  "generate-thread-title",
  "git-checkout-branch",
  "git-create-branch",
  "git-push",
  "install-recommended-skill",
  "local-environment-config-save",
  "open-file",
  "remove-skill",
  "set-configuration",
  "set-pinned-threads-order",
  "set-preferred-app",
  "set-thread-pinned",
  "submit-trace-recording-details",
  "upload-worktree-snapshot",
  "add-workspace-root-option",
  "electron-add-new-workspace-root-option",
  "electron-pick-workspace-root-option",
  "electron-rename-workspace-root-option",
  "electron-set-active-workspace-root",
  "electron-update-workspace-root-options",
  "thread-archived",
  "thread-unarchived"
]);

function deepClone(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function parseBody(body) {
  if (body === null || body === undefined || body === "") {
    return null;
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

function detectPlatform() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  const source = `${ua} ${platform}`;
  if (source.includes("win")) {
    return "win32";
  }
  if (source.includes("mac") || source.includes("darwin")) {
    return "darwin";
  }
  if (source.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

function normalizeRequestId(requestId) {
  if (requestId === null || requestId === undefined) {
    return "";
  }
  return String(requestId);
}

function makePathKey(pathname) {
  return pathname.replace(/^\/+/, "").replace(/\/+$/, "").trim();
}

function inferMethodNameFromRawUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }

  const raw = String(url);
  const lower = raw.toLowerCase();
  const marker = "/codex/";
  const markerIndex = lower.indexOf(marker);
  if (markerIndex >= 0) {
    const tail = raw.slice(markerIndex + marker.length);
    const end = tail.search(/[?#]/);
    const pathPart = end >= 0 ? tail.slice(0, end) : tail;
    const method = makePathKey(pathPart);
    if (method) {
      return method;
    }
  }

  const known = [
    "active-workspace-roots",
    "workspace-root-options",
    "get-global-state",
    "set-global-state",
    "mcp-codex-config",
    "get-copilot-api-proxy-info",
    "get-configuration",
    "git-origins"
  ];

  for (const candidate of known) {
    if (lower.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseCodexUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "vscode:") {
      return null;
    }

    const host = (parsed.hostname || "").toLowerCase();
    let methodPath = parsed.pathname || "";

    if (host === "codex") {
      // Expected format: vscode://codex/<method>
    } else if (methodPath.toLowerCase().startsWith("/codex/")) {
      // Defensive handling for formats like vscode:///codex/<method>
      methodPath = methodPath.slice("/codex".length);
    } else {
      return null;
    }

    return {
      parsed,
      methodName: makePathKey(methodPath)
    };
  } catch {
    return null;
  }
}

function createReadonlyError(methodName) {
  return `${READONLY_MESSAGE}: ${methodName} is disabled`;
}

function createDefaultMcpCodexConfig() {
  return {
    model: null,
    review_model: null,
    model_context_window: null,
    model_auto_compact_token_limit: null,
    model_provider: null,
    approval_policy: "never",
    sandbox_mode: "read-only",
    sandbox_workspace_write: null,
    forced_chatgpt_workspace_id: null,
    forced_login_method: null,
    web_search: null,
    tools: null,
    profile: null,
    profiles: {},
    instructions: null,
    developer_instructions: null,
    compact_prompt: null,
    model_reasoning_effort: null,
    model_reasoning_summary: null,
    model_verbosity: null,
    analytics: null,
    mcp_servers: {},
    apps: {}
  };
}

export class FetchAdapter {
  constructor(options = {}) {
    this.onReadonlyAction =
      typeof options.onReadonlyAction === "function"
        ? options.onReadonlyAction
        : null;

    this.globalState = new Map();
    this.runtimeState = null;
    this.activeWorkspaceRoots = [];
    this.workspaceRootOptions = { roots: [], labels: {} };
    this.pinnedThreadIds = [];

    this.seedDefaults();
  }

  seedDefaults() {
    this.globalState.set("active-workspace-roots", []);
    this.globalState.set("electron-saved-workspace-roots", []);
    this.globalState.set("electron-workspace-root-labels", {});
    this.globalState.set("pinned-thread-ids", []);
  }

  setRuntimeState(runtimeState) {
    this.runtimeState = runtimeState ? deepClone(runtimeState) : null;

    const cwd = this.runtimeState?.thread?.cwd;
    const threadId = this.runtimeState?.thread?.id;

    this.activeWorkspaceRoots = typeof cwd === "string" && cwd ? [cwd] : [];
    this.workspaceRootOptions = {
      roots: [...this.activeWorkspaceRoots],
      labels:
        this.activeWorkspaceRoots.length > 0
          ? { [this.activeWorkspaceRoots[0]]: "Transcript" }
          : {}
    };

    this.pinnedThreadIds = typeof threadId === "string" && threadId ? [threadId] : [];

    this.globalState.set("active-workspace-roots", [...this.activeWorkspaceRoots]);
    this.globalState.set(
      "electron-saved-workspace-roots",
      [...this.workspaceRootOptions.roots]
    );
    this.globalState.set(
      "electron-workspace-root-labels",
      deepClone(this.workspaceRootOptions.labels)
    );
    this.globalState.set("pinned-thread-ids", [...this.pinnedThreadIds]);
  }

  handleFetchRequest(request) {
    const requestId = normalizeRequestId(request?.requestId);
    const parsedUrl = parseCodexUrl(request?.url);
    const methodName = parsedUrl?.methodName || inferMethodNameFromRawUrl(request?.url);

    if (!methodName) {
      return this.successResponse(requestId, {});
    }

    const params = parseBody(request?.body);

    if (MUTATING_FETCH_METHODS.has(methodName)) {
      return this.readonlyErrorResponse(requestId, methodName);
    }

    try {
      const body = this.routeMethod(methodName, params, request);
      if (
        body &&
        typeof body === "object" &&
        body.type === "fetch-response" &&
        body.requestId !== undefined
      ) {
        return body;
      }
      return this.successResponse(requestId, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResponse(requestId, 500, message);
    }
  }

  handleFetchStreamRequest(request) {
    const requestId = normalizeRequestId(request?.requestId);
    return {
      type: "fetch-stream-complete",
      requestId
    };
  }

  handleFetchCancel(request) {
    const requestId = normalizeRequestId(request?.requestId);
    return this.errorResponse(requestId, 499, "Request cancelled");
  }

  readonlyErrorResponse(requestId, methodName) {
    const message = createReadonlyError(methodName);
    if (this.onReadonlyAction) {
      this.onReadonlyAction(message);
    }
    return this.errorResponse(requestId, 403, message);
  }

  routeMethod(methodName, params, request) {
    switch (methodName) {
      case "get-global-state": {
        const key = typeof params?.key === "string" ? params.key : null;
        return {
          key,
          value: key ? deepClone(this.globalState.get(key) ?? null) : null
        };
      }

      case "set-global-state": {
        const key = typeof params?.key === "string" ? params.key : null;
        if (!key) {
          return { ok: false };
        }
        this.globalState.set(key, deepClone(params?.value ?? null));
        return { ok: true };
      }

      case "active-workspace-roots":
        return { roots: [...this.activeWorkspaceRoots] };

      case "workspace-root-options":
        return {
          roots: [...this.workspaceRootOptions.roots],
          labels: deepClone(this.workspaceRootOptions.labels)
        };

      case "list-pinned-threads":
        return { threadIds: [...this.pinnedThreadIds] };

      case "locale-info":
        return {
          ideLocale: DEFAULT_LOCALE,
          systemLocale: DEFAULT_LOCALE
        };

      case "ide-context": {
        const cwd = this.activeWorkspaceRoots[0] ?? null;
        return {
          cwd,
          workspaceRoots: [...this.activeWorkspaceRoots],
          activeFilePath: null,
          openFiles: []
        };
      }

      case "mcp-codex-config":
        return { config: createDefaultMcpCodexConfig() };

      case "codex-home":
        return { codexHome: null };

      case "extension-info":
        return {
          host: "web",
          version: "readonly-transcript-viewer",
          platform: detectPlatform()
        };

      case "account-info":
        return {
          account: null,
          requiresOpenaiAuth: false
        };

      case "os-info":
        return {
          platform: detectPlatform()
        };

      case "is-copilot-api-available":
        return { available: false, isCopilotApiAvailable: false };

      case "gh-cli-status":
      case "gh-pr-status":
        return { available: false, installed: false };

      case "git-origins":
        return { origins: [] };

      case "has-custom-cli-executable":
        return { hasCustomCliExecutable: false };

      case "child-processes":
        return { processes: [] };

      case "local-environments":
        return { environments: [] };

      case "local-environment":
        return { environment: null };

      case "open-in-targets":
        return { targets: [] };

      case "recommended-skills":
        return { skills: [] };

      case "pick-files":
        return { files: [] };

      case "inbox-items":
        return { items: [], nextCursor: null };

      case "list-automations":
      case "pending-automation-runs":
        return { items: [], nextCursor: null };

      case "list-pending-automation-run-threads":
        return { threadIds: [] };

      case "third-party-notices":
        return { notices: [] };

      case "get-configuration":
        return {
          key: typeof params?.key === "string" ? params.key : null,
          value: null,
          config: {},
          configuration: {}
        };

      case "read-file":
        return { contents: null };

      case "read-file-binary":
      case "read-git-file-binary":
        return { contentsBase64: null };

      case "paths-exist": {
        const paths = Array.isArray(params?.paths) ? params.paths : [];
        return {
          results: paths.map((path) => ({ path, exists: false }))
        };
      }

      case "openai-api-key":
        return { hasApiKey: false };

      case "get-copilot-api-proxy-info":
        return null;

      case "ipc-request": {
        const requestId =
          typeof params?.requestId === "string" ? params.requestId : "readonly-ipc";
        return {
          requestId,
          type: "response",
          resultType: "error",
          error: READONLY_MESSAGE
        };
      }

      case "set-vs-context":
      case "confirm-trace-recording-start":
      case "cancel-trace-recording-start":
      case "prepare-worktree-snapshot":
      case "toggle-trace-recording":
        return {};

      default: {
        const method = String(methodName || "unknown");
        if (
          /^(set-|add-|remove-|apply-|upload-|submit-|archive|unarchive|thread-|automation-|git-)/.test(
            method
          )
        ) {
          return this.readonlyErrorResponse(
            normalizeRequestId(request?.requestId),
            method
          );
        }
        return {};
      }
    }
  }

  successResponse(requestId, body) {
    return {
      type: "fetch-response",
      requestId,
      responseType: "success",
      status: 200,
      headers: {
        "content-type": "application/json"
      },
      bodyJsonString: JSON.stringify(body ?? null)
    };
  }

  errorResponse(requestId, status, error) {
    return {
      type: "fetch-response",
      requestId,
      responseType: "error",
      status: Number.isFinite(status) ? status : 500,
      error: typeof error === "string" ? error : String(error)
    };
  }
}

export { READONLY_MESSAGE };
