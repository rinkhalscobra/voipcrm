import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { invoicePdf } from "../src/lib/reports/invoice";
import { exportCalls } from "../src/lib/reports/export";
describe("downloadable documents", () => {
  it("labels demo exports and PDFs as synthetic", async () => {
    const response = await exportCalls([{ id: "demo-fixture" }], "csv", true);
    expect(response.headers.get("content-disposition")).toContain(
      "calls-demo.csv",
    );
    expect(await response.text()).toContain("DEMO · SYNTHETIC DATA");
    const bytes = await invoicePdf({
      is_seed: true,
      number: "DEMO",
      currency: "EUR",
      invoice_items: [],
    } as unknown as Parameters<typeof invoicePdf>[0]);
    expect((await PDFDocument.load(bytes)).getSubject()).toContain(
      "Synthetic demo invoice",
    );
  });
  it("generates an actual multi-field PDF invoice", async () => {
    const bytes = await invoicePdf({
      number: "FIXTURE-1",
      company_id: "fixture",
      currency: "EUR",
      status: "issued",
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      subtotal: "10",
      tax: "1.9",
      total: "11.9",
      companies: { name: "Fixture company" },
      invoice_items: [
        {
          description: "Fixture usage",
          quantity: "1",
          unit_price: "10",
          tax_percent: "19",
        },
      ],
    } as unknown as Parameters<typeof invoicePdf>[0]);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
  });
  it("exports actual CSV with escaped formula-like numbers", async () => {
    const response = await exportCalls(
      [
        {
          id: "fixture",
          destination: "+12025550123",
          customer_charge: "0.123456",
          currency: "EUR",
        },
      ],
      "csv",
    );
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(await response.text()).toContain("'+12025550123");
  });
  it("exports a valid XLSX ZIP file", async () => {
    const response = await exportCalls(
      [{ id: "fixture", destination: "=1+1" }],
      "xlsx",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 2))).toEqual([80, 75]);
  });
});
