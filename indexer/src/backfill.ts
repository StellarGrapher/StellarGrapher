import {
  prisma,
  getBackfillCursor,
  setBackfillCursor,
  findIncompleteBackfill,
  clearBackfillCursor,
} from "./db.js";
import { PAGE_LIMIT, insertTransactions, server, failover } from "./index.js";
import { log } from "./logger.js";

/** Persist the checkpoint at least every this many ledgers. */
export const CHECKPOINT_INTERVAL = 100;

export interface BackfillOptions {
  resume?: boolean;
}

export async function backfill(
  fromLedger: number | undefined,
  toLedger: number | undefined,
  options: BackfillOptions = {}
): Promise<void> {
  if ((fromLedger === undefined) !== (toLedger === undefined)) {
    throw new Error("--from and --to must be provided together");
  }
  if (fromLedger !== undefined && (!Number.isSafeInteger(fromLedger) || fromLedger < 1)) {
    throw new Error("--from must be a positive ledger number");
  }
  if (
    toLedger !== undefined &&
    (!Number.isSafeInteger(toLedger) || fromLedger === undefined || toLedger < fromLedger)
  ) {
    throw new Error("--to must be a ledger number greater than or equal to --from");
  }

  if (options.resume) {
    const checkpoint = await findIncompleteBackfill();
    if (checkpoint) {
      fromLedger = checkpoint.fromLedger;
      toLedger = checkpoint.toLedger;
      log.info("resuming backfill from checkpoint", {
        component: "backfill",
        fromLedger,
        toLedger,
        lastLedger: checkpoint.lastLedger,
      });
    } else if (fromLedger === undefined || toLedger === undefined) {
      throw new Error("--resume requires an incomplete checkpoint or both --from and --to");
    } else {
      log.info("no checkpoint found; starting backfill", {
        component: "backfill",
        fromLedger,
        toLedger,
      });
    }
  }

  if (fromLedger === undefined || toLedger === undefined) {
    throw new Error("Usage: npm run backfill -- --from <ledger> --to <ledger> [--resume]");
  }

  let state = await getBackfillCursor(fromLedger, toLedger);
  if (state.completed) {
    log.info("ledger range is already complete", { component: "backfill", fromLedger, toLedger });
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
    failover.recordSuccess();

    let lastLedger = state.lastLedger;
    let reachedEnd = false;
    const page: typeof response.transactions = [];
    for (const tx of response.transactions) {
      if (tx.ledger > toLedger) {
        reachedEnd = true;
        break;
      }
      if (tx.ledger < fromLedger) continue;
      page.push(tx);
      lastLedger = Math.max(lastLedger, tx.ledger);
    }
    // One createMany per table for the whole page instead of one per transaction.
    await insertTransactions(page);

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

  log.info("completed ledger range", { component: "backfill", fromLedger, toLedger });
}

function parseRange(args: string[]): {
  fromLedger?: number;
  toLedger?: number;
  resume: boolean;
} {
  let from: string | undefined;
  let to: string | undefined;
  let resume = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--from") from = args[++i];
    else if (args[i] === "--to") to = args[++i];
    else if (args[i] === "--resume") resume = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (resume && from === undefined && to === undefined) return { resume };
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
  log.error("backfill failed", { component: "backfill", err });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
