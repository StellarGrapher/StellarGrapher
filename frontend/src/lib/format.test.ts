import { describe, expect, it } from "vitest";
import {
  balanceLabel,
  shortHash,
  stroopsToXlm,
  formatFee,
  formatNumber,
  timeAgo,
  formatContractId,
  formatDate,
  formatTimestampUtc,
} from "./format";

/** Largest values a Soroban i128 / u128 can hold. */
const MAX_I128 = 170141183460469231731687303715884105727n;
const MAX_U128 = 340282366920938463463374607431768211455n;

describe("shortHash", () => {
  it("truncates long hashes with an ellipsis", () => {
    const hash = "a".repeat(64);
    expect(shortHash(hash)).toBe("aaaaaa...aaaaaa");
  });

  it("leaves short strings untouched", () => {
    expect(shortHash("short")).toBe("short");
  });

  it("respects a custom character count", () => {
    const hash = "CDPUJYCTPGPEGS6MBXYLEWTYSGCPVKUHCURLF2ORT3RAVL5TF5JKIAI5";
    expect(shortHash(hash, 4)).toBe("CDPU...IAI5");
  });

  it("returns empty strings unchanged", () => {
    expect(shortHash("")).toBe("");
  });

  it("leaves a string exactly at the threshold untouched", () => {
    const atThreshold = "a".repeat(6 * 2 + 3);
    expect(shortHash(atThreshold)).toBe(atThreshold);
  });

  it("truncates a string one character past the threshold", () => {
    const past = "a".repeat(6 * 2 + 4);
    expect(shortHash(past)).toBe(`${"a".repeat(6)}...${"a".repeat(6)}`);
  });

  it("handles a zero character count", () => {
    expect(shortHash("GABCDEFGHIJKLMNOPQRSTUVWXYZ", 0)).toBe("...");
  });
});

describe("formatContractId", () => {
  it("shortens using 8 leading/trailing characters", () => {
    const id = "CDPUJYCTPGPEGS6MBXYLEWTYSGCPVKUHCURLF2ORT3RAVL5TF5JKIAI5";
    expect(formatContractId(id)).toBe(`${id.slice(0, 8)}...${id.slice(-8)}`);
  });

  it("returns empty and short ids unchanged", () => {
    expect(formatContractId("")).toBe("");
    expect(formatContractId("CABC")).toBe("CABC");
  });
});

describe("stroopsToXlm", () => {
  it("converts stroops to XLM with 7 decimal places", () => {
    expect(stroopsToXlm(10_000_000)).toBe("1.0000000 XLM");
    expect(stroopsToXlm(1)).toBe("0.0000001 XLM");
    expect(stroopsToXlm(0)).toBe("0.0000000 XLM");
  });

  it("formats the maximum i128 stroop value", () => {
    expect(stroopsToXlm(Number(MAX_I128))).toBe(
      "17014118346046923000000000000.0000000 XLM"
    );
  });

  it("formats the maximum u128 stroop value", () => {
    expect(stroopsToXlm(Number(MAX_U128))).toBe(
      "34028236692093846000000000000.0000000 XLM"
    );
  });
});

describe("formatFee", () => {
  it("adds thousands separators and a stroops suffix", () => {
    expect(formatFee(1234567)).toBe("1,234,567 stroops");
  });

  it("formats zero", () => {
    expect(formatFee(0)).toBe("0 stroops");
  });

  it("formats the maximum i128 fee", () => {
    expect(formatFee(Number(MAX_I128))).toBe(
      "170,141,183,460,469,230,000,000,000,000,000,000 stroops"
    );
  });

  it("formats the maximum u128 fee", () => {
    expect(formatFee(Number(MAX_U128))).toBe(
      "340,282,366,920,938,460,000,000,000,000,000,000 stroops"
    );
  });
});

describe("formatNumber", () => {
  it("adds thousands separators", () => {
    expect(formatNumber(4064026)).toBe("4,064,026");
    expect(formatNumber(0)).toBe("0");
  });

  it("formats the maximum i128", () => {
    expect(formatNumber(Number(MAX_I128))).toBe(
      "170,141,183,460,469,230,000,000,000,000,000,000"
    );
  });

  it("formats the maximum u128", () => {
    expect(formatNumber(Number(MAX_U128))).toBe(
      "340,282,366,920,938,460,000,000,000,000,000,000"
    );
  });
});

describe("timeAgo", () => {
  it("reports seconds for very recent timestamps", () => {
    const now = new Date();
    expect(timeAgo(new Date(now.getTime() - 5000).toISOString())).toMatch(/^\ds ago$/);
  });

  it("reports minutes for timestamps under an hour old", () => {
    const now = new Date();
    expect(timeAgo(new Date(now.getTime() - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  it("reports hours for timestamps under a day old", () => {
    const now = new Date();
    expect(timeAgo(new Date(now.getTime() - 3 * 3_600_000).toISOString())).toBe("3h ago");
  });

  it("reports days for older timestamps", () => {
    const now = new Date();
    expect(timeAgo(new Date(now.getTime() - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });

  it("clamps far-future timestamps to zero", () => {
    expect(timeAgo("9999-12-31T23:59:59.000Z")).toBe("0s ago");
  });

  it("treats an empty string as zero elapsed time", () => {
    expect(timeAgo("")).toBe("0s ago");
  });
});

describe("formatDate", () => {
  it("formats an ISO timestamp", () => {
    expect(formatDate("2024-01-02T03:04:05.000Z")).toMatch(/2024/);
  });

  it("formats a far-future timestamp", () => {
    expect(formatDate("9999-12-31T23:59:59.000Z")).toMatch(/9999/);
  });

  it("returns Invalid Date for an empty string", () => {
    expect(formatDate("")).toBe("Invalid Date");
  });
});

describe("formatTimestampUtc", () => {
  it("formats an ISO timestamp in UTC", () => {
    expect(formatTimestampUtc("2024-01-02T03:04:05.000Z")).toBe(
      "Jan 2, 2024, 3:04 AM UTC"
    );
  });

  it("formats a far-future timestamp", () => {
    expect(formatTimestampUtc("9999-12-31T23:59:59.000Z")).toBe(
      "Dec 31, 9999, 11:59 PM UTC"
    );
  });

  it("returns Invalid Date for an empty string", () => {
    expect(formatTimestampUtc("")).toBe("Invalid Date UTC");
  });
});

describe("balanceLabel", () => {
  it("labels native XLM", () => {
    expect(balanceLabel({ assetType: "native", balance: "10.0000000" })).toBe("XLM");
  });

  it("labels a credit asset with its code and shortened issuer", () => {
    const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    expect(
      balanceLabel({ assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: issuer, balance: "1" })
    ).toBe(`USDC:${issuer.slice(0, 4)}...${issuer.slice(-4)}`);
  });

  it("labels liquidity pool shares with a shortened pool ID, not 'undefined'", () => {
    const poolId = "dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7";
    const label = balanceLabel({
      assetType: "liquidity_pool_shares",
      liquidityPoolId: poolId,
      balance: "5",
    });
    expect(label).toBe(`Pool ${poolId.slice(0, 6)}...${poolId.slice(-6)}`);
    expect(label).not.toContain("undefined");
  });

  it("falls back to the asset type when there is no code or pool ID", () => {
    expect(balanceLabel({ assetType: "liquidity_pool_shares", balance: "5" })).toBe("liquidity_pool_shares");
  });

  it("omits the issuer separator when a credit asset has no issuer", () => {
    expect(balanceLabel({ assetType: "credit_alphanum4", assetCode: "USDC", balance: "1" })).toBe("USDC:");
  });

  it("falls back to the asset type for an empty asset code", () => {
    expect(balanceLabel({ assetType: "credit_alphanum12", assetCode: "", balance: "1" })).toBe("credit_alphanum12");
  });
});
