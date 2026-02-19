import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonlTranscript } from "./transcript-parser.js";
import { buildThreadRuntimeState } from "./replay-converter.js";

const ALLOWED_ITEM_TYPES = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "imageView",
  "contextCompaction",
  "enteredReviewMode",
  "exitedReviewMode",
  "webSearch",
  "collabAgentToolCall"
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countItems(turns) {
  let total = 0;
  for (const turn of turns) {
    if (Array.isArray(turn?.items)) {
      total += turn.items.length;
    }
  }
  return total;
}

async function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const repoRoot = path.resolve(thisDir, "..", "..");
  const examplePath = path.join(repoRoot, "example.jsonl");

  const text = await readFile(examplePath, "utf8");
  const parsed = parseJsonlTranscript(text);
  const runtime = buildThreadRuntimeState(parsed, { filename: "example.jsonl" });

  assert(runtime && typeof runtime === "object", "Runtime state is missing");
  assert(runtime.thread && typeof runtime.thread === "object", "Thread is missing");
  assert(typeof runtime.thread.id === "string" && runtime.thread.id.length > 0, "Thread id is missing");

  const turns = Array.isArray(runtime.thread.turns) ? runtime.thread.turns : [];
  assert(turns.length > 0, "No turns were generated from example.jsonl");

  for (const turn of turns) {
    assert(turn && typeof turn === "object", "Turn entry is invalid");
    assert(Array.isArray(turn.items), "Turn items must be an array");

    for (const item of turn.items) {
      assert(item && typeof item === "object", "Thread item is invalid");
      assert(
        typeof item.type === "string" && ALLOWED_ITEM_TYPES.has(item.type),
        `Unsupported item type: ${String(item.type)}`
      );
    }
  }

  const totalItems = countItems(turns);
  console.log(
    `dev-checks ok: turns=${turns.length}, items=${totalItems}, lines=${parsed.nonEmptyLines}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dev-checks failed: ${message}`);
  process.exitCode = 1;
});
