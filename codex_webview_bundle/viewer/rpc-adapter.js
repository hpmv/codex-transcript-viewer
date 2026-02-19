const READONLY_MESSAGE = "Readonly transcript viewer";

const MUTATING_METHODS = new Set([
  "turn/start",
  "turn/interrupt",
  "thread/start",
  "thread/fork",
  "thread/archive",
  "thread/unarchive",
  "thread/rollback",
  "config/value/write",
  "config/batchWrite",
  "skills/config/write",
  "feedback/upload",
  "account/logout",
  "account/login/start",
  "account/login/cancel",
  "mcpServer/oauth/login",
  "thread/name/write",
  "thread/name/update",
  "thread/setName"
]);

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function sandboxModeFromPolicy(policy) {
  if (!policy || typeof policy !== "object") {
    return "read-only";
  }
  if (policy.type === "dangerFullAccess") {
    return "danger-full-access";
  }
  if (policy.type === "workspaceWrite") {
    return "workspace-write";
  }
  return "read-only";
}

export class RpcError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export class RpcAdapter {
  constructor() {
    this.runtimeState = null;
  }

  setRuntimeState(runtimeState) {
    this.runtimeState = runtimeState ? deepClone(runtimeState) : null;
  }

  getRuntimeState() {
    return this.runtimeState ? deepClone(this.runtimeState) : null;
  }

  handleMcpRequest(request) {
    if (!request || typeof request !== "object") {
      throw new RpcError(-32600, "Invalid request");
    }

    const method =
      typeof request.method === "string" ? request.method : String(request.method);
    const params = request.params ?? {};

    if (MUTATING_METHODS.has(method)) {
      throw new RpcError(-32000, `${READONLY_MESSAGE}: ${method} is disabled`);
    }

    if (method.startsWith("fuzzyFileSearch/")) {
      return this.handleFuzzyFileSearch(method, params);
    }

    switch (method) {
      case "thread/list":
        return this.handleThreadList();
      case "thread/loaded/list":
        return this.handleThreadLoadedList();
      case "thread/read":
        return this.handleThreadRead(params);
      case "thread/resume":
        return this.handleThreadResume(params);
      case "thread/backgroundTerminals/clean":
        return {};
      case "model/list":
        return this.handleModelList();
      case "config/read":
        return this.handleConfigRead();
      case "configRequirements/read":
        return { requirements: null };
      case "account/read":
        return { account: null, requiresOpenaiAuth: false };
      case "skills/list":
        return { data: [] };
      case "app/list":
        return { data: [], nextCursor: null };
      case "mcpServerStatus/list":
        return { data: [], nextCursor: null };
      case "experimentalFeature/list":
        return { data: [], nextCursor: null };
      case "collaborationMode/list":
        return {
          data: [
            {
              mode: "default",
              displayName: "Default",
              description: "Default collaboration mode"
            }
          ],
          nextCursor: null
        };
      case "gitDiffToRemote":
        return { commits: [], files: [] };
      default:
        throw new RpcError(-32601, `Unsupported method: ${method}`);
    }
  }

  handleFuzzyFileSearch(method, params) {
    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId
        ? params.sessionId
        : "readonly-session";
    if (method === "fuzzyFileSearch/sessionStop") {
      return {};
    }
    return {
      sessionId,
      query: typeof params?.query === "string" ? params.query : "",
      results: [],
      done: true
    };
  }

  handleThreadList() {
    if (!this.runtimeState?.thread) {
      return { data: [], nextCursor: null };
    }
    return {
      data: [this.cloneThread(this.runtimeState.thread, false)],
      nextCursor: null
    };
  }

  handleThreadRead(params) {
    const includeTurns = Boolean(params?.includeTurns);
    const thread = this.requireThread(params?.threadId);
    return { thread: this.cloneThread(thread, includeTurns) };
  }

  handleThreadLoadedList() {
    if (!this.runtimeState?.thread?.id) {
      return { data: [], nextCursor: null };
    }
    return { data: [this.runtimeState.thread.id], nextCursor: null };
  }

  handleThreadResume(params) {
    const thread = this.requireThread(params?.threadId);
    const runtime = this.requireRuntime();
    return {
      thread: this.cloneThread(thread, true),
      model: runtime.model,
      modelProvider: runtime.modelProvider,
      cwd: thread.cwd,
      approvalPolicy: runtime.approvalPolicy,
      sandbox: runtime.sandbox,
      reasoningEffort: runtime.reasoningEffort
    };
  }

  handleModelList() {
    const runtime = this.runtimeState;
    const model = runtime?.model || "gpt-5";
    return {
      data: [
        {
          id: model,
          model,
          upgrade: null,
          displayName: model,
          description: "Model inferred from transcript metadata.",
          hidden: false,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          inputModalities: ["text"],
          supportsPersonality: true,
          isDefault: true
        }
      ],
      nextCursor: null
    };
  }

  handleConfigRead() {
    const runtime = this.runtimeState;
    const config = {
      model: runtime?.model || null,
      review_model: null,
      model_context_window: null,
      model_auto_compact_token_limit: null,
      model_provider: runtime?.modelProvider || null,
      approval_policy: runtime?.approvalPolicy || "never",
      sandbox_mode: runtime?.sandboxMode || "read-only",
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
      model_reasoning_effort: runtime?.reasoningEffort || null,
      model_reasoning_summary: null,
      model_verbosity: null,
      analytics: null
    };
    return { config, origins: {}, layers: null };
  }

  requireRuntime() {
    if (!this.runtimeState || !this.runtimeState.thread) {
      throw new RpcError(
        -32001,
        "No transcript loaded. Load a JSONL transcript first."
      );
    }
    return this.runtimeState;
  }

  requireThread(threadId) {
    const runtime = this.requireRuntime();
    const expectedId = runtime.thread.id;
    if (typeof threadId === "string" && threadId) {
      const normalized = threadId.startsWith("local:")
        ? threadId.slice("local:".length)
        : threadId;
      if (normalized !== expectedId) {
        // Viewer has exactly one in-memory thread; tolerate id mismatches
        // caused by host/client route-local aliases.
        return runtime.thread;
      }
    }
    return runtime.thread;
  }

  cloneThread(thread, includeTurns) {
    const copy = deepClone(thread);
    if (!includeTurns) {
      copy.turns = [];
    }
    if (!copy.status || typeof copy.status !== "object") {
      copy.status = { type: "idle" };
    }
    if (!copy.cwd) {
      copy.cwd = "/";
    }
    if (!copy.modelProvider) {
      copy.modelProvider = "unknown";
    }
    return copy;
  }
}

export function normalizeRpcError(error) {
  if (error instanceof RpcError) {
    return {
      code: error.code,
      message: error.message,
      data: error.data
    };
  }
  if (error instanceof Error) {
    return { code: -32000, message: error.message };
  }
  return { code: -32000, message: String(error) };
}

export function inferSandboxMode(runtimeState) {
  return sandboxModeFromPolicy(runtimeState?.sandbox);
}
