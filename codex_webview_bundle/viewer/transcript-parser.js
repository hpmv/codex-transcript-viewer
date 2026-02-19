function normalizeRecord(value, lineNumber) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Line ${lineNumber}: expected a JSON object`);
  }

  const type = typeof value.type === "string" ? value.type : null;
  if (!type) {
    throw new Error(`Line ${lineNumber}: missing string field "type"`);
  }

  return {
    lineNumber,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : null,
    type,
    payload: value.payload ?? null,
    raw: value
  };
}

export function parseJsonlTranscript(text) {
  if (typeof text !== "string") {
    throw new Error("Transcript content must be a string");
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const records = [];
  const sessionMetas = [];
  const turnContexts = [];
  const eventMsgs = [];
  const responseItems = [];
  const unknown = [];

  let nonEmptyLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    if (!rawLine.trim()) {
      continue;
    }
    nonEmptyLines += 1;

    let parsedLine;
    try {
      parsedLine = JSON.parse(rawLine);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "invalid JSON syntax";
      throw new Error(`Line ${lineNumber}: ${reason}`);
    }

    const record = normalizeRecord(parsedLine, lineNumber);
    records.push(record);

    switch (record.type) {
      case "session_meta":
        sessionMetas.push(record);
        break;
      case "turn_context":
        turnContexts.push(record);
        break;
      case "event_msg":
        eventMsgs.push(record);
        break;
      case "response_item":
        responseItems.push(record);
        break;
      default:
        unknown.push(record);
        break;
    }
  }

  return {
    text,
    totalLines: lines.length,
    nonEmptyLines,
    records,
    sessionMeta: sessionMetas[0] || null,
    sessionMetas,
    turnContexts,
    eventMsgs,
    responseItems,
    unknown
  };
}
