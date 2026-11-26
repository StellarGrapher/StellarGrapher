const http = require("node:http");
const { xdr, StrKey, hash } = require("@stellar/stellar-sdk");

// The showcase contract's ID is derived from its WASM hash, so the mock can
// answer for exactly one contract and 404 everything else.
const SHOWCASE_WASM_HASH = Buffer.alloc(32, 7);
const SHOWCASE_CONTRACT_ID = StrKey.encodeContract(hash(SHOWCASE_WASM_HASH));

const CONTRACT_ERROR = "HostError: Error(Contract, #3)";

/** Empty but valid WASM module header; the ABI lives in a custom section. */
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** Minimal contract spec: one function that succeeds, one that always fails. */
function buildSpecEntries() {
  const u32 = xdr.ScSpecTypeDef.scSpecTypeU32();
  const symbol = xdr.ScSpecTypeDef.scSpecTypeSymbol();
  const fn = (name, inputs) =>
    xdr.ScSpecEntry.scSpecEntryFunctionV0(
      new xdr.ScSpecFunctionV0({
        doc: "",
        name,
        inputs: inputs.map(([inputName, type]) => new xdr.ScSpecFunctionInputV0({ doc: "", name: inputName, type })),
        outputs: [u32],
      })
    );
  return [
    fn("note", [["author", symbol], ["text", symbol]]),
    fn("always_fails", [["code", u32]]),
  ];
}

function buildWasm() {
  const spec = Buffer.concat(buildSpecEntries().map((entry) => entry.toXDR()));
  // A custom section named "contractspecv0" is all the ABI parser reads.
  const name = Buffer.from("contractspecv0", "utf8");
  const header = Buffer.alloc(5);
  header.writeUInt8(0x00, 0); // custom section id
  header.writeUInt32BE(name.length + spec.length, 1);
  return Buffer.concat([WASM_MAGIC, header, name, spec]);
}

const WASM = buildWasm();

function contractInstanceEntry() {
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableWasm(SHOWCASE_WASM_HASH),
    storage: [],
  });
  return new xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: xdr.ScAddress.scAddressTypeContract(SHOWCASE_CONTRACT_ID),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(instance),
    })
  );
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function handleRpc(method, params, id) {
  switch (method) {
    case "getLatestLedger":
      return rpcResult(id, { sequence: 1000, id: "mock", protocolVersion: 22 });
    case "getContractData":
      if (params.contract !== SHOWCASE_CONTRACT_ID) {
        return { jsonrpc: "2.0", id, error: { code: -32603, message: "contract not found" } };
      }
      return rpcResult(id, {
        latestLedger: 1000,
        lastModifiedLedgerSeq: 900,
        liveUntilLedgerSeq: 5000,
        key: xdr.LedgerKey.contractData(
          new xdr.LedgerKeyContractData({
            contract: xdr.ScAddress.scAddressTypeContract(SHOWCASE_CONTRACT_ID),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
          })
        ).toXDR("base64"),
        val: contractInstanceEntry().toXDR("base64"),
      });
    case "getContractCode":
      return rpcResult(id, { latestLedger: 1000, wasm: WASM.toString("base64") });
    case "getEvents":
      return rpcResult(id, { latestLedger: 1000, events: [] });
    case "simulateTransaction": {
      const envelope = xdr.TransactionEnvelope.fromXDR(params.transaction, "base64");
      const op = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().hostFunction();
      const invocation = op.invokeContract();
      const functionName = invocation.functionName().toString();
      if (functionName === "always_fails") {
        return rpcResult(id, { latestLedger: 1000, error: CONTRACT_ERROR });
      }
      const retval = xdr.ScVal.scvU32(42);
      const transactionData = new xdr.SorobanTransactionData({
        ext: new xdr.SorobanTransactionDataExt(0),
        resources: new xdr.SorobanResources({
          footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
          instructions: 1_234_567,
          readBytes: 0,
          writeBytes: 0,
        }),
        resourceFee: xdr.Int64.fromString("123456"),
      });
      return rpcResult(id, {
        latestLedger: 1000,
        transactionData: transactionData.toXDR("base64"),
        minResourceFee: "123456",
        results: [{ auth: [], xdr: retval.toXDR("base64") }],
        events: [],
      });
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (req.method === "POST") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let id = null;
      let payload = null;
      try {
        payload = JSON.parse(body);
        id = payload.id;
      } catch {
        payload = null;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (!payload || typeof payload.method !== "string") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "No fixture data" },
        }));
        return;
      }
      res.end(JSON.stringify(handleRpc(payload.method, payload.params ?? {}, id)));
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({
    title: "Resource Missing",
    status: 404,
    detail: "No fixture data",
  }));
});

server.listen(8765, "127.0.0.1");
