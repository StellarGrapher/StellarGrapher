import {
  Address,
  StrKey,
  encodeMuxedAccountToAddress,
  xdr,
  scValToNative,
  type rpc,
} from "@stellar/stellar-sdk";

function toDisplaySafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(toDisplaySafe);
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries()).map(([k, v]) => [String(toDisplaySafe(k)), toDisplaySafe(v)])
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toDisplaySafe(v)])
    );
  }
  return value;
}

/** Decode an ScVal to a compact display string. Mirrors frontend/src/lib/xdr.ts's scValToDisplay. */
export function scValToDisplay(val: xdr.ScVal): string {
  const switchName = val.switch().name;
  if (switchName === "scvVoid") return "void";
  if (switchName === "scvLedgerKeyContractInstance") return "__instance__";
  // scvContractInstance wraps an ScContractInstance struct (executable + storage
  // map), not plain data — scValToNative doesn't decode it, and JSON-stringifying
  // it directly dumps the internal js-xdr class. Callers that expect a contract
  // instance value should read it via .instance() instead of this function.
  if (switchName === "scvContractInstance") return "(contract instance)";
  try {
    const decoded = toDisplaySafe(scValToNative(val));
    return typeof decoded === "string" ? decoded : JSON.stringify(decoded);
  } catch {
    return "(unrepresentable value)";
  }
}

export interface DecodedInvocation {
  contractId: string;
  functionName: string;
  args: unknown;
}

function unwrapTx(envelope: xdr.TransactionEnvelope) {
  return envelope.switch().name === "envelopeTypeTxFeeBump"
    ? envelope.feeBump().tx().innerTx().v1().tx()
    : envelope.v1().tx();
}

export function decodeInvocation(envelope: xdr.TransactionEnvelope): DecodedInvocation | null {
  try {
    const tx = unwrapTx(envelope);
    for (const op of tx.operations()) {
      if (op.body().switch().name !== "invokeHostFunction") continue;
      const hostFn = op.body().invokeHostFunctionOp().hostFunction();
      if (hostFn.switch().name !== "hostFunctionTypeInvokeContract") continue;
      const invoke = hostFn.invokeContract();
      return {
        contractId: Address.fromScAddress(invoke.contractAddress()).toString(),
        functionName: invoke.functionName().toString(),
        args: invoke.args().map(scValToDisplay),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function extractInvocationReturnValue(meta: xdr.TransactionMeta): string | null {
  const returnValue = sorobanReturnValue(meta);
  return returnValue ? scValToDisplay(returnValue) : null;
}

export interface DecodedContractCreation {
  contractId: string;
  creator: string;
  /** Hex-encoded 32-byte salt of the createContract host function. */
  salt: string;
  /** Hex-encoded WASM hash of the uploaded executable. */
  wasmHash: string;
  /** Operation-specific deployer, or null when it inherits the transaction source. */
  deployerAccountId: string | null;
}

/** Source account of an operation, or null when it inherits the transaction source. */
function operationSourceAccount(op: xdr.Operation): string | null {
  try {
    const source = op.sourceAccount();
    if (!source) return null;
    return encodeMuxedAccountToAddress(source);
  } catch {
    return null;
  }
}

/** Ledger key for a contract's instance entry, used to look up its TTL. */
export function contractInstanceLedgerKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

/**
 * Expiration ledger of a contract instance entry from a getLedgerEntries
 * response, or null when the entry is absent or carries no TTL.
 */
export function contractExpiresAtLedger(
  response: rpc.Api.GetLedgerEntriesResponse,
  contractId: string
): number | null {
  try {
    const wanted = contractInstanceLedgerKey(contractId).toXDR("base64");
    for (const entry of response.entries ?? []) {
      if (entry.key.toXDR("base64") !== wanted) continue;
      const liveUntil = entry.liveUntilLedgerSeq;
      return typeof liveUntil === "number" && liveUntil > 0 ? liveUntil : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function decodeContractCreation(
  envelope: xdr.TransactionEnvelope,
  meta: xdr.TransactionMeta,
  creator: string
): DecodedContractCreation | null {
  try {
    const tx = unwrapTx(envelope);
    let salt: string | null = null;
    let wasmHash: string | null = null;
    let deployerAccountId: string | null = null;
    for (const op of tx.operations()) {
      if (op.body().switch().name !== "invokeHostFunction") continue;
      const hostFunction = op.body().invokeHostFunctionOp().hostFunction();
      const kind = hostFunction.switch().name;
      if (kind === "hostFunctionTypeCreateContract") {
        const create = hostFunction.createContract();
        salt = Buffer.from(create.contractIdPreimage().fromAddress().salt()).toString("hex");
        wasmHash = Buffer.from(create.executable().wasm().hash()).toString("hex");
      } else if (kind === "hostFunctionTypeCreateContractV2") {
        const create = hostFunction.createContractV2();
        salt = Buffer.from(create.contractIdPreimage().fromAddress().salt()).toString("hex");
        wasmHash = Buffer.from(create.executable().wasm().hash()).toString("hex");
      } else {
        continue;
      }
      deployerAccountId = operationSourceAccount(op);
      break;
    }
    if (salt === null || wasmHash === null) return null;
    const returnValue = sorobanReturnValue(meta);
    if (!returnValue) return null;
    if (returnValue.switch().name !== "scvAddress") return null;
    return {
      contractId: Address.fromScAddress(returnValue.address()).toString(),
      creator,
      salt,
      wasmHash,
      deployerAccountId,
    };
  } catch {
    return null;
  }
}

function sorobanReturnValue(meta: xdr.TransactionMeta): xdr.ScVal | null {
  try {
    if (meta.switch() === 3) return meta.v3().sorobanMeta()?.returnValue() ?? null;
    if (meta.switch() === 4) return meta.v4().sorobanMeta()?.returnValue() ?? null;
  } catch {
    return null;
  }
  return null;
}

export interface DecodedStorageChange {
  contractId: string;
  durability: "persistent" | "temporary" | "instance";
  // Position of the change within the transaction's meta. Together with the
  // tx hash it identifies the row, so reprocessing a transaction after a
  // restart maps onto the same rows instead of colliding on the natural key.
  changeIndex: number;
  keyDisplay: string;
  valueDisplay: string | null;
  changeType: "created" | "updated" | "removed" | "state";
}

/**
 * Extract every ContractData ledger-entry change from a transaction's
 * per-operation meta. Includes "state" rows (the entry's value immediately
 * before this operation) alongside created/updated/removed, giving a full
 * append-only change log rather than just latest-value snapshots.
 */
export function extractStorageChanges(meta: xdr.TransactionMeta): DecodedStorageChange[] {
  const switchValue = meta.switch();
  const v = switchValue === 4 ? meta.v4() : switchValue === 3 ? meta.v3() : null;
  if (!v) return [];

  const out: DecodedStorageChange[] = [];
  for (const opMeta of v.operations()) {
    for (const change of opMeta.changes()) {
      const kind = change.switch().name;
      if (kind === "ledgerEntryRemoved") {
        const key = change.removed();
        if (key.switch().name !== "contractData") continue;
        const cd = key.contractData();
        out.push({
          contractId: Address.fromScAddress(cd.contract()).toString(),
          durability: cd.durability().name as "persistent" | "temporary",
          changeIndex: out.length,
          keyDisplay: scValToDisplay(cd.key()),
          valueDisplay: null,
          changeType: "removed",
        });
        continue;
      }

      const entry =
        kind === "ledgerEntryCreated"
          ? change.created()
          : kind === "ledgerEntryUpdated"
            ? change.updated()
            : kind === "ledgerEntryState"
              ? change.state()
              : null;
      if (!entry) continue;

      const data = entry.data();
      if (data.switch().name !== "contractData") continue;
      const cd = data.contractData();
      const isInstanceKey = cd.key().switch().name === "scvLedgerKeyContractInstance";
      const changeType =
        kind === "ledgerEntryCreated" ? "created" : kind === "ledgerEntryUpdated" ? "updated" : "state";
      const contractId = Address.fromScAddress(cd.contract()).toString();

      if (isInstanceKey) {
        out.push(...expandInstanceEntry(contractId, cd.val(), changeType, out.length));
        continue;
      }

      out.push({
        contractId,
        durability: cd.durability().name as "persistent" | "temporary",
        changeIndex: out.length,
        keyDisplay: scValToDisplay(cd.key()),
        valueDisplay: scValToDisplay(cd.val()),
        changeType,
      });
    }
  }
  return out;
}

/**
 * The contract instance entry's value is an ScContractInstance struct
 * (executable + an instance-storage map), not plain data — unpack it into
 * one row for the WASM hash (tracks upgrades) plus one row per instance
 * storage entry, rather than dumping the struct as an opaque blob.
 */
function expandInstanceEntry(
  contractId: string,
  val: xdr.ScVal,
  changeType: DecodedStorageChange["changeType"],
  startIndex: number
): DecodedStorageChange[] {
  if (val.switch().name !== "scvContractInstance") return [];
  const instance = val.instance();
  const out: DecodedStorageChange[] = [];

  const executable = instance.executable();
  if (executable.switch().name === "contractExecutableWasm") {
    out.push({
      contractId,
      durability: "instance",
      changeIndex: startIndex + out.length,
      keyDisplay: "__wasm_hash__",
      valueDisplay: executable.wasmHash().toString("hex"),
      changeType,
    });
  }

  for (const entry of instance.storage() ?? []) {
    out.push({
      contractId,
      durability: "instance",
      changeIndex: startIndex + out.length,
      keyDisplay: scValToDisplay(entry.key()),
      valueDisplay: scValToDisplay(entry.val()),
      changeType,
    });
  }

  return out;
}

export interface DecodedEvent {
  eventId: string;
  eventIndex: number;
  contractId: string;
  type: string;
  topic: string[];
  value: string;
  /** Raw event data, kept so token events can be decoded without re-parsing the meta. */
  data?: xdr.ScVal;
  /** Raw topics, kept so token events can read their addresses. */
  rawTopics?: xdr.ScVal[];
  /** Set only for synthesized `contract_created` events. */
  deployer?: string;
  salt?: string;
  wasmHash?: string;
}

/**
 * Synthesize the `contract_created` event for a contract deployment. Soroban
 * emits no contract event for creation itself, so the indexer records one from
 * the createContract host function plus the transaction's return value.
 */
export function contractCreatedEvent(
  creation: DecodedContractCreation,
  txHash: string
): DecodedEvent {
  return {
    eventId: `${txHash}-contract_created`,
    eventIndex: -1,
    contractId: creation.contractId,
    type: "contract_created",
    topic: ["contract_created", creation.creator],
    value: JSON.stringify({
      deployer: creation.creator,
      salt: creation.salt,
      wasmHash: creation.wasmHash,
    }),
    deployer: creation.creator,
    salt: creation.salt,
    wasmHash: creation.wasmHash,
  };
}

/**
 * Extract contract-type events (skips system/diagnostic) from a transaction's
 * meta. V4 carries events per operation; V3 carries them once on the
 * transaction's Soroban meta. A Soroban transaction has exactly one operation,
 * so V3's events are attributed to operation 0.
 */
export function extractEvents(meta: xdr.TransactionMeta, txHash: string): DecodedEvent[] {
  const switchValue = meta.switch();
  if (switchValue === 3) {
    const events = meta.v3().sorobanMeta()?.events() ?? [];
    return events.flatMap((event, eventIndex) => decodeEvent(event, txHash, 0, eventIndex));
  }
  if (switchValue !== 4) return [];

  const out: DecodedEvent[] = [];
  meta.v4().operations().forEach((opMeta, opIndex) => {
    opMeta.events().forEach((event, eventIndex) => {
      out.push(...decodeEvent(event, txHash, opIndex, eventIndex));
    });
  });
  return out;
}

function decodeEvent(
  event: xdr.ContractEvent,
  txHash: string,
  opIndex: number,
  eventIndex: number
): DecodedEvent[] {
  if (event.type().name !== "contract") return [];
  // The generated type says Hash (Opaque[]) but js-xdr represents fixed
  // opaque values as Buffer at runtime — same as elsewhere in this codebase.
  let contractIdBuf: Buffer | null;
  try {
    contractIdBuf = event.contractId() as unknown as Buffer | null;
  } catch {
    return [];
  }
  if (!contractIdBuf) return [];

  const body = event.body().v0();
  return [
    {
      eventId: `${txHash}-${opIndex}-${eventIndex}`,
      eventIndex,
      contractId: StrKey.encodeContract(contractIdBuf),
      type: event.type().name,
      topic: body.topics().map(scValToDisplay),
      value: scValToDisplay(body.data()),
      data: body.data(),
      rawTopics: body.topics(),
    },
  ];
}

/** SEP-41 token event names, as they appear in the first topic. */
export const TOKEN_EVENT_NAMES = ["transfer", "mint", "burn", "approve"] as const;
export type TokenEventName = (typeof TOKEN_EVENT_NAMES)[number];

export interface DecodedTokenEvent {
  eventId: string;
  tokenContractId: string;
  eventType: TokenEventName;
  /** Address the tokens came from; null for `mint`. */
  from: string | null;
  /** Address the tokens went to; null for `burn`. */
  to: string | null;
  /** Address approved to spend, for `approve`; null otherwise. */
  spender: string | null;
  /** Amount as a decimal string (i128/u128 don't fit a JS number). */
  amount: string;
  txHash: string;
  ledger: number;
}

function addressFromScVal(val: xdr.ScVal | undefined): string | null {
  if (!val || val.switch().name !== "scvAddress") return null;
  try {
    return Address.fromScAddress(val.address()).toString();
  } catch {
    return null;
  }
}

function amountFromScVal(val: xdr.ScVal | undefined): string | null {
  if (!val) return null;
  try {
    const native = scValToNative(val);
    if (typeof native === "bigint") return native.toString();
    if (typeof native === "number" || typeof native === "string") return String(native);
  } catch {
    // Fall through: not a plain numeric value.
  }
  return null;
}

/**
 * Decode a SEP-41 token event (`transfer`, `mint`, `burn`, `approve`) from an
 * already-extracted contract event. SEP-41 emits `(name, from, to, ...)` as
 * topics and the amount as the data value; `mint` has no `from` and `burn` has
 * no `to`. Returns null for any other event.
 */
export function decodeTokenEvent(
  event: DecodedEvent,
  txHash: string,
  ledger: number
): DecodedTokenEvent | null {
  const name = event.topic[0];
  if (!name || !(TOKEN_EVENT_NAMES as readonly string[]).includes(name)) return null;

  const amount = amountFromScVal(event.data);
  if (amount === null) return null;

  const from = name === "mint" ? null : addressFromScVal(event.rawTopics?.[1]);
  const to =
    name === "mint"
      ? addressFromScVal(event.rawTopics?.[1])
      : name === "transfer"
        ? addressFromScVal(event.rawTopics?.[2])
        : null;

  return {
    eventId: event.eventId,
    tokenContractId: event.contractId,
    eventType: name as TokenEventName,
    from,
    to,
    // `approve` topics are (approve, from, spender, live_until_ledger).
    spender: name === "approve" ? addressFromScVal(event.rawTopics?.[2]) : null,
    amount,
    txHash,
    ledger,
  };
}
