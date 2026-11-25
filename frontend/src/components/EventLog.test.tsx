import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EventLog from "./EventLog";
import type { ContractEvent, ContractEventSpec } from "@/types";

const events: ContractEvent[] = [
  {
    id: "0000001234567-0000000001",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    type: "contract",
    topic: ["transfer", "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"],
    value: '{"to":"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC","amount":"1000"}',
    txHash: "9f2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
    ledger: 1234567,
    timestamp: "2026-10-21T09:30:00Z",
  },
  {
    id: "0000001234567-0000000002",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    type: "contract",
    topic: ["mint"],
    value: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    txHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    ledger: 1234567,
    timestamp: "2026-10-21T09:31:00Z",
  },
];

const specs: ContractEventSpec[] = [
  {
    name: "Transfer",
    prefixTopics: ["transfer"],
    params: [
      { name: "from", type: "Address", location: "topic" },
      { name: "to", type: "Address", location: "data" },
      { name: "amount", type: "i128", location: "data" },
    ],
    dataFormat: "map",
    doc: "Emitted on every transfer.",
  },
];

describe("EventLog", () => {
  it("renders labelled and raw events", () => {
    expect(renderToStaticMarkup(<EventLog events={events} specs={specs} />)).toMatchSnapshot();
  });

  it("renders the empty state", () => {
    expect(renderToStaticMarkup(<EventLog events={[]} />)).toMatchSnapshot();
  });

  it("renders the error state", () => {
    expect(renderToStaticMarkup(<EventLog events={[]} error="connection refused" />)).toMatchSnapshot();
  });
});
