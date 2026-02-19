const SESSION_SOURCES = new Set([
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown"
]);

const APPROVAL_POLICIES = new Set([
  "untrusted",
  "on-failure",
  "on-request",
  "never"
]);

const TURN_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "inProgress"
]);

const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);

function randomId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now()}-${rand}`;
}

function toUnixSeconds(value) {
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return Math.floor(ms / 1000);
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function normalizeSource(source) {
  if (typeof source === "string" && SESSION_SOURCES.has(source)) {
    return source;
  }
  return "unknown";
}

function normalizeGitInfo(gitInfo) {
  const git = asObject(gitInfo);
  if (!git) {
    return null;
  }
  const sha =
    typeof git.sha === "string"
      ? git.sha
      : typeof git.commit_hash === "string"
        ? git.commit_hash
        : null;
  const branch = typeof git.branch === "string" ? git.branch : null;
  const originUrl =
    typeof git.originUrl === "string"
      ? git.originUrl
      : typeof git.repository_url === "string"
        ? git.repository_url
        : null;
  return { sha, branch, originUrl };
}

function normalizeApprovalPolicy(value) {
  if (typeof value === "string" && APPROVAL_POLICIES.has(value)) {
    return value;
  }
  return "never";
}

function normalizeSandboxPolicy(value, cwd) {
  const fallback = { type: "readOnly", access: { type: "fullAccess" } };

  if (typeof value === "string") {
    if (value === "danger-full-access") {
      return { type: "dangerFullAccess" };
    }
    if (value === "workspace-write") {
      return {
        type: "workspaceWrite",
        writableRoots: [cwd],
        readOnlyAccess: { type: "fullAccess" },
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      };
    }
    if (value === "read-only") {
      return fallback;
    }
    return fallback;
  }

  const policy = asObject(value);
  if (!policy || typeof policy.type !== "string") {
    return fallback;
  }

  if (policy.type === "dangerFullAccess" || policy.type === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (policy.type === "readOnly" || policy.type === "read-only") {
    return {
      type: "readOnly",
      access: asObject(policy.access) || { type: "fullAccess" }
    };
  }
  if (policy.type === "workspaceWrite" || policy.type === "workspace-write") {
    const writableRoots = Array.isArray(policy.writableRoots)
      ? policy.writableRoots
      : Array.isArray(policy.writable_roots)
        ? policy.writable_roots
        : [cwd];
    return {
      type: "workspaceWrite",
      writableRoots,
      readOnlyAccess:
        asObject(policy.readOnlyAccess) ||
        asObject(policy.read_only_access) || { type: "fullAccess" },
      networkAccess:
        typeof policy.networkAccess === "boolean"
          ? policy.networkAccess
          : typeof policy.network_access === "boolean"
            ? policy.network_access
            : true,
      excludeTmpdirEnvVar:
        typeof policy.excludeTmpdirEnvVar === "boolean"
          ? policy.excludeTmpdirEnvVar
          : typeof policy.exclude_tmpdir_env_var === "boolean"
            ? policy.exclude_tmpdir_env_var
            : false,
      excludeSlashTmp:
        typeof policy.excludeSlashTmp === "boolean"
          ? policy.excludeSlashTmp
          : typeof policy.exclude_slash_tmp === "boolean"
            ? policy.exclude_slash_tmp
            : false
    };
  }

  return fallback;
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

function normalizeReasoningEffort(value) {
  if (typeof value === "string" && REASONING_EFFORTS.has(value)) {
    return value;
  }
  return null;
}

function nextItemId(counter) {
  const value = counter.current;
  counter.current += 1;
  return `item-${value}`;
}

function materializeTurn(turn) {
  return {
    id: turn.id,
    items: turn.items,
    status: turn.status,
    error: turn.error
  };
}

function makeTurn(turnId = null) {
  return {
    id: turnId || randomId("turn"),
    items: [],
    status: "completed",
    error: null,
    openedExplicitly: false,
    sawCompaction: false
  };
}

function eventTurnId(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.turn_id === "string") {
    return payload.turn_id;
  }
  if (typeof payload.turnId === "string") {
    return payload.turnId;
  }
  return null;
}

function buildUserMessageContent(payload) {
  const content = [];
  if (typeof payload.message === "string" && payload.message.trim()) {
    content.push({
      type: "text",
      text: payload.message,
      text_elements: Array.isArray(payload.text_elements)
        ? payload.text_elements
        : Array.isArray(payload.textElements)
          ? payload.textElements
          : []
    });
  }
  if (Array.isArray(payload.images)) {
    for (const image of payload.images) {
      if (typeof image === "string" && image) {
        content.push({ type: "image", url: image });
      }
    }
  }
  if (Array.isArray(payload.local_images)) {
    for (const imagePath of payload.local_images) {
      if (typeof imagePath === "string" && imagePath) {
        content.push({ type: "localImage", path: imagePath });
      }
    }
  }
  return content;
}

function extractResponseMessageText(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (
      (item.type === "input_text" ||
        item.type === "output_text" ||
        item.type === "text") &&
      typeof item.text === "string"
    ) {
      parts.push(item.text);
    }
  }
  return parts.join("\n").trim();
}

function extractReasoningText(summaryOrContent) {
  if (!Array.isArray(summaryOrContent)) {
    return [];
  }
  const values = [];
  for (const entry of summaryOrContent) {
    if (typeof entry === "string" && entry.trim()) {
      values.push(entry);
      continue;
    }
    if (entry && typeof entry === "object" && typeof entry.text === "string") {
      if (entry.text.trim()) {
        values.push(entry.text);
      }
    }
  }
  return values;
}

function buildFallbackTurns(responseItems) {
  const turns = [];
  const counter = { current: 1 };
  let currentTurn = null;

  function ensureTurn() {
    if (!currentTurn) {
      currentTurn = makeTurn();
    }
    return currentTurn;
  }

  for (const record of responseItems) {
    const payload = asObject(record.payload);
    if (!payload || typeof payload.type !== "string") {
      continue;
    }

    if (payload.type === "message") {
      const text = extractResponseMessageText(payload.content);
      if (!text) {
        continue;
      }
      const role = typeof payload.role === "string" ? payload.role : "assistant";
      if (role === "user") {
        if (currentTurn && currentTurn.items.length > 0) {
          turns.push(materializeTurn(currentTurn));
        }
        currentTurn = makeTurn();
        currentTurn.items.push({
          type: "userMessage",
          id: nextItemId(counter),
          content: [{ type: "text", text, text_elements: [] }]
        });
      } else {
        const turn = ensureTurn();
        turn.items.push({
          type: "agentMessage",
          id: nextItemId(counter),
          text,
          phase:
            payload.phase === "commentary" || payload.phase === "finalAnswer"
              ? payload.phase
              : null
        });
      }
      continue;
    }

    if (payload.type === "reasoning") {
      const summary = extractReasoningText(payload.summary);
      const content = extractReasoningText(payload.content);
      if (summary.length === 0 && content.length === 0) {
        continue;
      }
      const turn = ensureTurn();
      turn.items.push({
        type: "reasoning",
        id: nextItemId(counter),
        summary,
        content
      });
    }
  }

  if (currentTurn && currentTurn.items.length > 0) {
    turns.push(materializeTurn(currentTurn));
  }
  return turns;
}

function findFirstUserPreview(turns) {
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "userMessage" || !Array.isArray(item.content)) {
        continue;
      }
      for (const part of item.content) {
        if (part?.type === "text" && typeof part.text === "string") {
          const text = part.text.trim();
          if (text) {
            return text;
          }
        }
      }
    }
  }
  return "";
}

function buildTurnsFromEventMessages(eventMsgs) {
  const turns = [];
  let currentTurn = null;
  const counter = { current: 1 };

  function finishCurrentTurn() {
    if (!currentTurn) {
      return;
    }
    if (
      currentTurn.items.length === 0 &&
      !currentTurn.openedExplicitly &&
      !currentTurn.sawCompaction
    ) {
      currentTurn = null;
      return;
    }
    turns.push(materializeTurn(currentTurn));
    currentTurn = null;
  }

  function ensureTurn() {
    if (!currentTurn) {
      currentTurn = makeTurn();
    }
    return currentTurn;
  }

  function findTurnById(turnId) {
    if (!turnId) {
      return null;
    }
    return turns.find((turn) => turn.id === turnId) || null;
  }

  function markTurnCompleted(turn) {
    if (!turn) {
      return;
    }
    if (turn.status === "inProgress" || turn.status === "completed") {
      turn.status = "completed";
    }
  }

  for (const record of eventMsgs) {
    const payload = asObject(record.payload);
    const kind = typeof payload?.type === "string" ? payload.type : null;
    if (!kind) {
      continue;
    }

    if (kind === "user_message") {
      if (
        currentTurn &&
        !currentTurn.openedExplicitly &&
        !(currentTurn.sawCompaction && currentTurn.items.length === 0)
      ) {
        finishCurrentTurn();
      }
      const turn = currentTurn || makeTurn();
      currentTurn = turn;
      turn.items.push({
        type: "userMessage",
        id: nextItemId(counter),
        content: buildUserMessageContent(payload)
      });
      continue;
    }

    if (kind === "agent_message") {
      const text = typeof payload.message === "string" ? payload.message : "";
      if (!text) {
        continue;
      }
      ensureTurn().items.push({
        type: "agentMessage",
        id: nextItemId(counter),
        text,
        phase: null
      });
      continue;
    }

    if (kind === "agent_reasoning") {
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text) {
        continue;
      }
      const turn = ensureTurn();
      const lastItem = turn.items[turn.items.length - 1];
      if (lastItem?.type === "reasoning") {
        lastItem.summary.push(text);
      } else {
        turn.items.push({
          type: "reasoning",
          id: nextItemId(counter),
          summary: [text],
          content: []
        });
      }
      continue;
    }

    if (kind === "agent_reasoning_raw_content") {
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text) {
        continue;
      }
      const turn = ensureTurn();
      const lastItem = turn.items[turn.items.length - 1];
      if (lastItem?.type === "reasoning") {
        lastItem.content.push(text);
      } else {
        turn.items.push({
          type: "reasoning",
          id: nextItemId(counter),
          summary: [],
          content: [text]
        });
      }
      continue;
    }

    if (kind === "task_started" || kind === "turn_started") {
      finishCurrentTurn();
      currentTurn = makeTurn(eventTurnId(payload));
      currentTurn.openedExplicitly = true;
      currentTurn.status = "inProgress";
      continue;
    }

    if (kind === "task_complete" || kind === "turn_complete") {
      const turnId = eventTurnId(payload);
      if (turnId && currentTurn?.id === turnId) {
        markTurnCompleted(currentTurn);
        finishCurrentTurn();
        continue;
      }

      const previousTurn = findTurnById(turnId);
      if (previousTurn) {
        markTurnCompleted(previousTurn);
        continue;
      }

      if (currentTurn) {
        markTurnCompleted(currentTurn);
        finishCurrentTurn();
      }
      continue;
    }

    if (kind === "turn_aborted") {
      const turnId = eventTurnId(payload);
      if (turnId && currentTurn?.id === turnId) {
        currentTurn.status = "interrupted";
        continue;
      }
      const previousTurn = findTurnById(turnId);
      if (previousTurn) {
        previousTurn.status = "interrupted";
        continue;
      }
      if (currentTurn) {
        currentTurn.status = "interrupted";
      }
      continue;
    }

    if (kind === "thread_rolled_back") {
      finishCurrentTurn();
      const rawCount =
        typeof payload.num_turns === "number"
          ? payload.num_turns
          : typeof payload.numTurns === "number"
            ? payload.numTurns
            : 0;
      const count = Math.max(0, Math.floor(rawCount));
      if (count >= turns.length) {
        turns.length = 0;
      } else if (count > 0) {
        turns.splice(turns.length - count, count);
      }
      const itemCount = turns.reduce(
        (sum, turn) => sum + (Array.isArray(turn.items) ? turn.items.length : 0),
        0
      );
      counter.current = itemCount + 1;
      continue;
    }

    if (kind === "token_count") {
      continue;
    }
  }

  finishCurrentTurn();

  for (const turn of turns) {
    if (!TURN_STATUSES.has(turn.status)) {
      turn.status = "completed";
    }
  }
  return turns;
}

export function buildThreadRuntimeState(parsedTranscript, options = {}) {
  const parsed = asObject(parsedTranscript);
  if (!parsed) {
    throw new Error("Parsed transcript must be an object");
  }

  const allTimestamps = [];
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  for (const record of records) {
    const seconds = toUnixSeconds(record?.timestamp);
    if (seconds !== null) {
      allTimestamps.push(seconds);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const createdAt = allTimestamps.length > 0 ? Math.min(...allTimestamps) : now;
  const updatedAt = allTimestamps.length > 0 ? Math.max(...allTimestamps) : createdAt;

  const sessionMeta = asObject(parsed.sessionMeta?.payload) || {};
  const turnContexts = Array.isArray(parsed.turnContexts) ? parsed.turnContexts : [];
  const latestTurnContext =
    asObject(turnContexts[turnContexts.length - 1]?.payload) || null;

  let turns = buildTurnsFromEventMessages(
    Array.isArray(parsed.eventMsgs) ? parsed.eventMsgs : []
  );
  let fallbackUsed = false;
  if (turns.length === 0) {
    turns = buildFallbackTurns(
      Array.isArray(parsed.responseItems) ? parsed.responseItems : []
    );
    fallbackUsed = true;
  }

  const source = normalizeSource(sessionMeta.source);
  const cwd = typeof sessionMeta.cwd === "string" ? sessionMeta.cwd : "/";
  const id = typeof sessionMeta.id === "string" ? sessionMeta.id : randomId("thread");
  const cliVersion =
    typeof sessionMeta.cli_version === "string"
      ? sessionMeta.cli_version
      : typeof sessionMeta.cliVersion === "string"
        ? sessionMeta.cliVersion
        : "unknown";
  const modelProvider =
    typeof sessionMeta.model_provider === "string"
      ? sessionMeta.model_provider
      : typeof sessionMeta.modelProvider === "string"
        ? sessionMeta.modelProvider
        : "unknown";

  const preview = findFirstUserPreview(turns);

  const model =
    typeof latestTurnContext?.model === "string" && latestTurnContext.model
      ? latestTurnContext.model
      : "gpt-5";
  const approvalPolicy = normalizeApprovalPolicy(latestTurnContext?.approval_policy);
  const sandbox = normalizeSandboxPolicy(latestTurnContext?.sandbox_policy, cwd);
  const reasoningEffort = normalizeReasoningEffort(latestTurnContext?.effort);

  const thread = {
    id,
    preview,
    modelProvider,
    createdAt,
    updatedAt,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion,
    source,
    gitInfo: normalizeGitInfo(sessionMeta.git),
    turns
  };

  const itemCount = turns.reduce(
    (sum, turn) => sum + (Array.isArray(turn.items) ? turn.items.length : 0),
    0
  );

  return {
    thread,
    model,
    modelProvider,
    approvalPolicy,
    sandbox,
    sandboxMode: sandboxModeFromPolicy(sandbox),
    reasoningEffort,
    meta: {
      fileName:
        typeof options.filename === "string" && options.filename
          ? options.filename
          : null,
      totalLines:
        typeof parsed.totalLines === "number" ? parsed.totalLines : records.length,
      nonEmptyLines:
        typeof parsed.nonEmptyLines === "number"
          ? parsed.nonEmptyLines
          : records.length,
      turnCount: turns.length,
      itemCount,
      fallbackUsed
    }
  };
}
