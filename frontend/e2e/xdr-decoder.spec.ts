import { expect, test } from "@playwright/test";
import {
  ledgerEntryXdr,
  ledgerKeyXdr,
  scValXdr,
  specEntryXdr,
  transactionEnvelopeXdr,
  transactionMetaXdr,
  transactionResultXdr,
} from "./xdr-fixtures";

/**
 * The decoder identifies a blob by decoding and re-encoding it, so each case
 * asserts the detected type label plus one field the fixture is known to carry.
 */
const cases = [
  {
    name: "transaction envelope",
    type: "TransactionEnvelope",
    blob: transactionEnvelopeXdr,
    field: "Envelope type",
    value: "envelopeTypeTx",
  },
  {
    name: "transaction result",
    type: "TransactionResult",
    blob: transactionResultXdr,
    field: "Fee charged",
    value: "100 stroops",
  },
  {
    name: "transaction meta",
    type: "TransactionMeta",
    blob: transactionMetaXdr,
    field: "Meta version",
    value: "v0",
  },
  {
    name: "ledger entry",
    type: "LedgerEntry",
    blob: ledgerEntryXdr,
    field: "Last modified ledger",
    value: "1234",
  },
  {
    name: "ledger key",
    type: "LedgerKey",
    blob: ledgerKeyXdr,
    field: "Key type",
    value: "contractData",
  },
  {
    name: "contract spec entry",
    type: "ScSpecEntry",
    blob: specEntryXdr,
    field: "Function",
    value: "increment",
  },
  {
    name: "ScVal",
    type: "ScVal",
    blob: scValXdr,
    field: "ScVal type",
    value: "scvU32",
  },
];

for (const { name, type, blob, field, value } of cases) {
  test(`decodes a ${name}`, async ({ page }) => {
    await page.goto("/xdr");
    await page.getByRole("textbox").fill(blob);
    await page.getByRole("button", { name: "Decode" }).click();

    await expect(page.getByText("detected type")).toBeVisible();
    await expect(page.getByText(type, { exact: true })).toBeVisible();
    await expect(page.getByText(field, { exact: true })).toBeVisible();
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  });
}

test("reports an error for invalid input", async ({ page }) => {
  await page.goto("/xdr");
  await page.getByRole("textbox").fill("not-valid-xdr!!");
  await page.getByRole("button", { name: "Decode" }).click();

  await expect(page.getByText(/Not valid XDR of a type Prism recognizes/)).toBeVisible();
  await expect(page.getByText("detected type")).toHaveCount(0);
});
