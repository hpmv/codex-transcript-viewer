import { normalizeRpcError } from "./rpc-adapter.js";
import { READONLY_MESSAGE } from "./fetch-adapter.js";

const SILENT_CLIENT_TYPES = new Set([
  "ready",
  "view-focused",
  "log-message",
  "set-telemetry-user",
  "thread-stream-state-changed",
  "thread-role-response",
  "thread-queued-followups-changed",
  "thread-follower-command-approval-decision-response",
  "thread-follower-file-approval-decision-response",
  "thread-follower-interrupt-turn-response",
  "thread-follower-set-collaboration-mode-response",
  "thread-follower-set-model-and-reasoning-response",
  "thread-follower-set-queued-follow-ups-state-response",
  "thread-follower-start-turn-response",
  "thread-follower-submit-user-input-response",
  "mcp-response"
]);

const READONLY_INTENT_TYPES = new Set([
  "archive-thread",
  "unarchive-thread",
  "thread-archived",
  "thread-unarchived",
  "terminal-attach",
  "terminal-close",
  "terminal-create",
  "terminal-resize",
  "terminal-write",
  "open-in-browser",
  "open-vscode-command",
  "open-config-toml",
  "open-debug-window",
  "open-extension-settings",
  "open-keyboard-shortcuts",
  "install-app-update",
  "navigate-in-new-editor-tab",
  "inbox-item-set-read-state",
  "inbox-items-create",
  "show-diff",
  "show-plan-summary",
  "update-diff-if-open",
  "codex-app-server-restart",
  "electron-add-new-workspace-root-option",
  "electron-add-ssh-host",
  "electron-onboarding-skip-workspace",
  "electron-pick-workspace-root-option",
  "electron-rename-workspace-root-option",
  "electron-request-microphone-permission",
  "electron-set-active-workspace-root",
  "electron-set-window-mode",
  "electron-update-workspace-root-options",
  "open-thread-overlay",
  "thread-overlay-set-always-on-top",
  "toggle-trace-recording"
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

function targetOrigin() {
  const origin = window.location.origin;
  return origin && origin !== "null" ? origin : "*";
}

export class HostBridge {
  constructor(options = {}) {
    this.rpcAdapter = options.rpcAdapter;
    this.fetchAdapter = options.fetchAdapter;
    this.onReadonlyAction =
      typeof options.onReadonlyAction === "function"
        ? options.onReadonlyAction
        : null;
    this.onHostLog =
      typeof options.onHostLog === "function" ? options.onHostLog : null;

    this.runtimeState = null;
    this.vscodeState = {};

    this.persistedAtoms = new Map();
    this.sharedObjects = new Map();
    this.sharedObjectSubscriberCounts = new Map();

    this.vscodeApi = {
      postMessage: (message) => this.handleClientMessage(message),
      setState: (state) => {
        this.vscodeState = state ? deepClone(state) : {};
        return this.vscodeState;
      },
      getState: () => deepClone(this.vscodeState)
    };

    this.installAcquireVsCodeApi();
    this.seedSharedObjects();
  }

  installAcquireVsCodeApi() {
    const api = this.vscodeApi;
    window.acquireVsCodeApi = () => api;
  }

  seedSharedObjects() {
    this.sharedObjects.set("host_config", {
      id: "local",
      kind: "local",
      appHost: "extension",
      platform: detectPlatform(),
      cwd: null,
      workspaceRoot: null,
      workspaceRoots: []
    });
  }

  setRuntimeState(runtimeState) {
    this.runtimeState = runtimeState ? deepClone(runtimeState) : null;

    if (this.rpcAdapter?.setRuntimeState) {
      this.rpcAdapter.setRuntimeState(this.runtimeState);
    }
    if (this.fetchAdapter?.setRuntimeState) {
      this.fetchAdapter.setRuntimeState(this.runtimeState);
    }

    this.updateHostConfigFromRuntime();
    this.emitHostMessage("active-workspace-roots-updated", {});
    this.emitHostMessage("workspace-root-options-updated", {});
  }

  clearRuntimeState() {
    this.setRuntimeState(null);
  }

  updateHostConfigFromRuntime() {
    const cwd = this.runtimeState?.thread?.cwd ?? null;
    this.sharedObjects.set("host_config", {
      id: "local",
      kind: "local",
      appHost: "extension",
      platform: detectPlatform(),
      cwd,
      workspaceRoot: cwd,
      workspaceRoots: cwd ? [cwd] : []
    });
    this.emitSharedObjectUpdate("host_config", true);
  }

  emitThreadLoaded() {
    const thread = this.runtimeState?.thread;
    if (!thread?.id) {
      return;
    }

    // Do not emit `thread/started` here. In the webview client that marks the
    // conversation as already resumed with empty turns, which bypasses
    // `thread/resume` and leaves transcript content unhydrated.
    this.emitHostMessage("navigate-to-route", {
      path: `/local/${thread.id}`
    });
  }

  handleClientMessage(message) {
    if (!message || typeof message !== "object") {
      return false;
    }

    const type = typeof message.type === "string" ? message.type : null;
    if (!type) {
      return false;
    }

    switch (type) {
      case "persisted-atom-sync-request":
        this.emitHostMessage("persisted-atom-sync", {
          state: Object.fromEntries(this.persistedAtoms)
        });
        return true;

      case "persisted-atom-update":
        this.handlePersistedAtomUpdate(message);
        return true;

      case "shared-object-subscribe":
        this.handleSharedObjectSubscribe(message);
        return true;

      case "shared-object-unsubscribe":
        this.handleSharedObjectUnsubscribe(message);
        return true;

      case "shared-object-set":
        this.handleSharedObjectSet(message);
        return true;

      case "mcp-request":
        queueMicrotask(() => this.handleMcpRequest(message));
        return true;

      case "fetch":
        queueMicrotask(() => this.handleFetchRequest(message));
        return true;

      case "fetch-stream":
        queueMicrotask(() => this.handleFetchStreamRequest(message));
        return true;

      case "cancel-fetch-stream":
        this.emitHostMessage("fetch-stream-complete", {
          requestId: String(message.requestId ?? "")
        });
        return true;

      case "cancel-fetch":
        queueMicrotask(() => this.handleFetchCancel(message));
        return true;

      case "worker-request":
        queueMicrotask(() => this.handleWorkerRequest(message));
        return true;

      case "worker-request-cancel":
        return true;

      default:
        if (READONLY_INTENT_TYPES.has(type)) {
          this.notifyReadonly(`${READONLY_MESSAGE}: ${type} is disabled`);
          return true;
        }

        if (SILENT_CLIENT_TYPES.has(type)) {
          this.logHostMessage(type, message);
          return true;
        }

        this.logHostMessage(type, message);
        return true;
    }
  }

  handlePersistedAtomUpdate(message) {
    const key = typeof message.key === "string" ? message.key : null;
    if (!key) {
      return;
    }

    if (message.deleted) {
      this.persistedAtoms.delete(key);
    } else {
      this.persistedAtoms.set(key, deepClone(message.value));
    }

    this.emitHostMessage("persisted-atom-updated", {
      key,
      value: message.deleted ? undefined : deepClone(message.value),
      deleted: Boolean(message.deleted)
    });
  }

  handleSharedObjectSubscribe(message) {
    const key = typeof message.key === "string" ? message.key : null;
    if (!key) {
      return;
    }

    const prev = this.sharedObjectSubscriberCounts.get(key) ?? 0;
    this.sharedObjectSubscriberCounts.set(key, prev + 1);
    this.emitSharedObjectUpdate(key, true);
  }

  handleSharedObjectUnsubscribe(message) {
    const key = typeof message.key === "string" ? message.key : null;
    if (!key) {
      return;
    }

    const prev = this.sharedObjectSubscriberCounts.get(key) ?? 0;
    if (prev <= 1) {
      this.sharedObjectSubscriberCounts.delete(key);
      return;
    }
    this.sharedObjectSubscriberCounts.set(key, prev - 1);
  }

  handleSharedObjectSet(message) {
    const key = typeof message.key === "string" ? message.key : null;
    if (!key) {
      return;
    }

    this.sharedObjects.set(key, deepClone(message.value));
    this.emitSharedObjectUpdate(key, true);
  }

  emitSharedObjectUpdate(key, force = false) {
    const subscribers = this.sharedObjectSubscriberCounts.get(key) ?? 0;
    if (!force && subscribers === 0) {
      return;
    }

    const hasValue = this.sharedObjects.has(key);
    const value = hasValue ? deepClone(this.sharedObjects.get(key)) : undefined;
    this.emitHostMessage("shared-object-updated", {
      key,
      value
    });
  }

  handleMcpRequest(message) {
    const request = message?.request;
    const requestId = request?.id;
    const method =
      typeof request?.method === "string" ? request.method : String(request?.method);

    if (!this.rpcAdapter?.handleMcpRequest) {
      this.logHostMessage("log-message", {
        level: "error",
        message: "RPC adapter not configured",
        requestId,
        method
      });
      this.emitHostMessage("mcp-response", {
        message: {
          id: requestId,
          error: {
            code: -32000,
            message: "RPC adapter not configured"
          }
        }
      });
      return;
    }

    try {
      const result = this.rpcAdapter.handleMcpRequest(request);
      this.logHostMessage("log-message", {
        level: "debug",
        message: "mcp-request handled",
        requestId,
        method
      });
      this.emitHostMessage("mcp-response", {
        message: {
          id: requestId,
          result
        }
      });
    } catch (error) {
      const normalized = normalizeRpcError(error);
      this.logHostMessage("log-message", {
        level: "error",
        message: "mcp-request failed",
        requestId,
        method,
        error: normalized
      });
      if (String(normalized.message || "").includes(READONLY_MESSAGE)) {
        this.notifyReadonly(String(normalized.message));
      }
      this.emitHostMessage("mcp-response", {
        message: {
          id: requestId,
          error: normalized
        }
      });
    }
  }

  handleFetchRequest(message) {
    if (!this.fetchAdapter?.handleFetchRequest) {
      return;
    }

    const response = this.fetchAdapter.handleFetchRequest(message);
    if (response?.responseType === "error") {
      this.logHostMessage("log-message", {
        level: "warning",
        message: "fetch-request failed",
        requestId: response.requestId,
        url: message?.url,
        method: message?.method,
        status: response.status,
        error: response.error
      });
    }
    if (response) {
      this.emitRaw(response);
    }
  }

  handleFetchStreamRequest(message) {
    if (this.fetchAdapter?.handleFetchStreamRequest) {
      const streamResponse = this.fetchAdapter.handleFetchStreamRequest(message);
      if (streamResponse) {
        this.emitRaw(streamResponse);
        return;
      }
    }

    this.emitHostMessage("fetch-stream-complete", {
      requestId: String(message?.requestId ?? "")
    });
  }

  handleFetchCancel(message) {
    if (this.fetchAdapter?.handleFetchCancel) {
      const response = this.fetchAdapter.handleFetchCancel(message);
      if (response) {
        this.emitRaw(response);
      }
    }
  }

  handleWorkerRequest(message) {
    const workerId = message?.workerId;
    const request = message?.request;

    this.emitHostMessage("worker-response", {
      workerId,
      response: {
        id: request?.id,
        method: request?.method,
        result: {
          type: "error",
          error: {
            message: READONLY_MESSAGE
          }
        }
      }
    });
  }

  notifyReadonly(message) {
    if (!this.onReadonlyAction) {
      return;
    }
    this.onReadonlyAction(message || READONLY_MESSAGE);
  }

  logHostMessage(type, message) {
    if (!this.onHostLog) {
      return;
    }

    this.onHostLog({ type, message });
  }

  emitHostMessage(type, payload) {
    this.emitRaw({
      type,
      ...(payload && typeof payload === "object" ? payload : {})
    });
  }

  emitRaw(message) {
    window.postMessage(message, targetOrigin());
  }
}

export function createHostBridge(options = {}) {
  return new HostBridge(options);
}
