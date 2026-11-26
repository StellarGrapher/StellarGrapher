import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContractOverview from "./ContractOverview";
import type { ContractInfo, ContractWasmInfo } from "@/types";

const info: ContractInfo = {
  executable: "wasm",
  wasmHash: "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
  liveUntilLedgerSeq: 2345678,
  lastModifiedLedgerSeq: 1234567,
  instanceStorage: [],
  creator: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  deploymentLedger: 1200000,
};

const wasm: ContractWasmInfo = {
  size: 4096,
  functions: [
    { name: "write_note", inputs: [{ name: "author", type: "Address" }, { name: "text", type: "String" }], outputs: ["u32"] },
    { name: "read_note", inputs: [{ name: "id", type: "u32" }], outputs: ["Note"] },
  ],
  events: [
    {
      name: "NoteWritten",
      prefixTopics: ["note_written"],
      params: [
        { name: "author", type: "Address", location: "topic" },
        { name: "id", type: "u32", location: "data" },
      ],
      dataFormat: "map",
      doc: "Emitted when a note is written.",
    },
  ],
  types: [
    { kind: "struct", name: "Note", fields: [{ name: "author", type: "Address" }, { name: "text", type: "String" }] },
    { kind: "enum", name: "Error", cases: [{ name: "NotFound", value: 1 }] },
  ],
};

describe("ContractOverview", () => {
  it("renders contract details with the embedded ABI", () => {
    expect(renderToStaticMarkup(<ContractOverview info={info} wasm={wasm} />)).toMatchSnapshot();
  });

  it("renders the error state when the contract could not be loaded", () => {
    expect(renderToStaticMarkup(<ContractOverview info={null} wasm={null} />)).toMatchSnapshot();
  });
});
