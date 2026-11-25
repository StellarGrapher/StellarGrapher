import {
  prisma,
  getBackfillCursor,
  setBackfillCursor,
  findIncompleteBackfill,
  clearBackfillCursor,
} from "./db.js";
import { PAGE_LIMIT, processTransaction, server } from "./index.js";

/** Persist the checkpoint at least every this many ledgers. */
export const CHECKPOINT_INTERVAL = 100;

export interface BackfillOptions {
  resume?: boolean;
}

export async function backfill(
  fromLedger: number,
  toLedger: number,
  options: BackfillOptions = {}
): Promise<void> {
  if (!Number.isSafeInteger(fromLedger) || fromLedger < 1) {
    throw new Error("--from must be a positive ledger number");
  }
  if (!Number.isSafeInteger(toLedger) || toLedger < fromLedger) {
    throw new Error("--to must be a ledger number greater than or equal to --from");
  }

  if (options.resume) {
    const checkpoint = await findIncompleteBackfill();
    if (!checkpoint) {
      console.log("[backfill] no checkpoint found; starting from --from");
    } else {
      fromLedger = checkpoint.fromLedger;
      toLedger = checkpoint.toLedger;
      console.log(
        `[backfill] resuming ledger range ${fromLedger}-${toLedger} from ledger ${checkpoint.lastLedger}`
      );
    }
  }

  let state = await getBackfillCursor(fromLedger, toLedger);
  if (state.completed) {
    console.log(`[backfill] ledger range ${fromLedger}-${toLedger} is already complete`);
    return;
  }

  let checkpointedLedger = state.lastLedger;

  while (true) {
    const response = state.paginationCursor
      ? await server.getTransactions({ pagination: { limit: PAGE_LIMIT, cursor: state.paginationCursor } })
      : await server.getTransactions({
          startLedger: Math.max(fromLedger, state.lastLedger + 1),
          pagination: { limit: PAGE_LIMIT },
        });

    let lastLedger = state.lastLedger;
    let reachedEnd = false;
    for (const tx of response.transactions) {
      if (tx.ledger > toLedger) {
        reachedEnd = true;
        break;
      }
      if (tx.ledger < fromLedger) continue;
      await processTransaction(tx);
      lastLedger = Math.max(lastLedger, tx.ledger);
    }

    if (reachedEnd) {
      await clearBackfillCursor();
      break;
    }

    if (response.transactions.length === PAGE_LIMIT) {
      if (!response.cursor || response.cursor === state.paginationCursor) {
        throw new Error("RPC returned a full page without advancing its transaction cursor");
      }
      if (lastLedger - checkpointedLedger >= CHECKPOINT_INTERVAL) {
        await setBackfillCursor(fromLedger, toLedger, lastLedger, response.cursor, false);
        checkpointedLedger = lastLedger;
      }
      state = { ...state, lastLedger, paginationCursor: response.cursor };
      continue;
    }

    if (response.latestLedger < toLedger) {
      await setBackfillCursor(fromLedger, toLedger, lastLedger, null, false);
      throw new Error(
        `RPC history currently reaches ledger ${response.latestLedger}, before requested ledger ${toLedger}; rerun the same command to resume.`
      );
    }

    await clearBackfillCursor();
    break;
  }

  console.log(`[backfill] completed ledger range ${fromLedger}-${toLedger}`);
}

function parseRange(args: string[]): { fromLedger: number; toLedger: number; resume: boolean } {
  let from: string | undefined;
  let to: string | undefined;
  let resume = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--from") from = args[++i];
    else if (args[i] === "--to") to = args[++i];
    else if (args[i] === "--resume") resume = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (resume && from === undefined && to === undefined) {
    return { fromLedger: 1, toLedger: 1, resume };
  }
  if (from === undefined || to === undefined) {
    throw new Error("Usage: npm run backfill -- --from <ledger> --to <ledger> [--resume]");
  }
  const fromLedger = Number(from);
  const toLedger = Number(to);
  if (!Number.isSafeInteger(fromLedger) || !Number.isSafeInteger(toLedger)) {
    throw new Error("--from and --to must be safe integers");
  }
  return { fromLedger, toLedger, resume };
}

try {
  const { fromLedger, toLedger, resume } = parseRange(process.argv.slice(2));
  await backfill(fromLedger, toLedger, { resume });
} catch (err) {
  console.error("[backfill] failed:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
