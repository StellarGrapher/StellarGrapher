import { Account, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

/**
 * Base64 XDR fixtures for the decoder E2E tests, built with the same
 * stellar-sdk the app decodes with. Building them here rather than pasting
 * opaque blobs keeps them readable and lets a test assert on the values it
 * put in.
 */

const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

function buildEnvelope(): xdr.TransactionEnvelope {
  const tx = new TransactionBuilder(new Account(SOURCE, "42"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: SOURCE, asset: xdr.Asset.native(), amount: "1" }))
    .setTimeout(0)
    .build();
  return tx.toEnvelope();
}

export const transactionEnvelopeXdr = buildEnvelope().toXDR("base64");

export const transactionResultXdr = new xdr.TransactionResult({
  feeCharged: xdr.Int64.fromString("100"),
  result: xdr.TransactionResultResult.txSuccess([]),
  ext: new xdr.TransactionResultExt(0),
}).toXDR("base64");

export const transactionMetaXdr = new xdr.TransactionMeta(0, []).toXDR("base64");

export const ledgerEntryXdr = new xdr.LedgerEntry({
  lastModifiedLedgerSeq: 1234,
  data: new xdr.LedgerEntryData(
    "account",
    new xdr.AccountEntry({
      accountId: new xdr.AccountId.publicKeyTypeEd25519(Keypair.fromPublicKey(SOURCE).rawPublicKey()),
      balance: xdr.Int64.fromString("10000000"),
      seqNum: xdr.Int64.fromString("42"),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext: new xdr.AccountEntryExt(0),
    })
  ),
  ext: new xdr.LedgerEntryExt(0),
}).toXDR("base64");

export const ledgerKeyXdr = new xdr.LedgerKey(
  "contractData",
  new xdr.LedgerKeyContractData({
    contract: new xdr.ScAddress.contractType(Buffer.alloc(32, 1)),
    key: xdr.ScVal.scvSymbol("counter"),
    durability: xdr.ContractDataDurability.persistent(),
  })
).toXDR("base64");

export const specEntryXdr = new xdr.ScSpecEntry.scSpecEntryFunctionV0(
  new xdr.ScSpecFunctionV0({
    name: "increment",
    inputs: [],
    outputs: [xdr.ScSpecTypeDef.scSpecTypeU32()],
    doc: "",
  })
).toXDR("base64");

export const scValXdr = xdr.ScVal.scvU32(7).toXDR("base64");
