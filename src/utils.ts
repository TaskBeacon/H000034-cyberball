interface SummaryRow {
  block_id?: unknown;
  participant_received?: unknown;
  participant_turn?: unknown;
  from_player?: unknown;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function isTossRow(row: SummaryRow): boolean {
  if (typeof row.from_player === "number") {
    return true;
  }
  if (typeof row.participant_turn === "boolean") {
    return true;
  }
  if (typeof row.participant_received === "boolean") {
    return true;
  }
  return false;
}

function summarize(rows: SummaryRow[]): {
  total_tosses: number;
  participant_receives: number;
  participant_turns: number;
} {
  const tossRows = rows.filter(isTossRow);
  let receives = 0;
  let turns = 0;

  for (const row of tossRows) {
    if (toBool(row.participant_received)) {
      receives += 1;
    }
    if (toBool(row.participant_turn)) {
      turns += 1;
    }
  }

  return {
    total_tosses: tossRows.length,
    participant_receives: receives,
    participant_turns: turns
  };
}

export function summarizeBlock(
  reducedRows: Record<string, unknown>[],
  blockId: string
): {
  total_tosses: number;
  participant_receives: number;
  participant_turns: number;
} {
  const rows = reducedRows.filter((row) => String(row.block_id ?? "") === blockId) as SummaryRow[];
  return summarize(rows);
}

export function summarizeOverall(
  reducedRows: Record<string, unknown>[]
): {
  total_tosses: number;
  participant_receives: number;
  participant_turns: number;
} {
  return summarize(reducedRows as SummaryRow[]);
}

