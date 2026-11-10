import { describe, it, expect } from "vitest";
import { rateCall, invoiceTotals } from "../src/lib/billing/rating";
import { csvCell } from "../src/lib/reports/export";
describe("decimal billing", () => {
  it("uses minimum duration and billing increments", () =>
    expect(
      rateCall(61, {
        perMinute: "0.037",
        connectionFee: "0.01",
        minimumSeconds: 90,
        incrementSeconds: 60,
      }),
    ).toEqual({ billableSeconds: 120, amount: "0.084000" }));
  it("rounds decimal-safe per-second charges to six decimal places", () =>
    expect(
      rateCall(1, {
        perMinute: "0.1",
        connectionFee: "0",
        minimumSeconds: 0,
        incrementSeconds: 1,
      }).amount,
    ).toBe("0.001667"));
  it("rejects a zero billing increment", () =>
    expect(() =>
      rateCall(3, {
        perMinute: "1",
        connectionFee: "0",
        minimumSeconds: 0,
        incrementSeconds: 0,
      }),
    ).toThrow());
  it("calculates invoice taxes without binary floating point drift", () =>
    expect(
      invoiceTotals([{ quantity: "3", unitPrice: "0.1", taxPercent: "19" }]),
    ).toEqual({ subtotal: "0.300000", tax: "0.057000", total: "0.357000" }));
  it("rejects negative invoice prices", () =>
    expect(() =>
      invoiceTotals([{ quantity: "1", unitPrice: "-1", taxPercent: "0" }]),
    ).toThrow());
  it("neutralizes spreadsheet formula injection", () => {
    expect(csvCell('=HYPERLINK("https://example.com")')).toBe(
      '"\'=HYPERLINK(""https://example.com"")"',
    );
    expect(csvCell("+493012345678")).toBe('"\'+493012345678"');
  });
});
