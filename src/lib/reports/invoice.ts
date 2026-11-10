import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DataRow } from "../types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const printable = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
export async function invoicePdf(invoice: DataRow) {
  const pdf = await PDFDocument.create();
  const platformName = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel";
  pdf.setTitle(`${platformName} · Invoice ${invoice.number}`);
  pdf.setAuthor(platformName);
  pdf.setCreator(platformName);
  pdf.setProducer(platformName);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = await pdf.embedPng(
    await readFile(join(process.cwd(), "public/logo.png")),
  );
  let page = pdf.addPage([595, 842]),
    y = 780;
  const line = (text: string, size = 11) => {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 780;
    }
    page.drawText(printable(text).slice(0, 110), {
      x: 48,
      y,
      size,
      font,
      color: rgb(0.13, 0.14, 0.2),
    });
    y -= size + 16;
  };
  page.drawImage(logo, { x: 447, y: 724, ...logo.scaleToFit(100, 100) });
  line(platformName, 26);
  if (invoice.is_seed) {
    pdf.setSubject("Synthetic demo invoice - no real payment is due");
    line("DEMO DATA - NO REAL PAYMENT IS DUE", 12);
  }
  line(`Invoice ${invoice.number}`, 20);
  line(
    `Company: ${(invoice.companies as Record<string, unknown> | null)?.name ?? invoice.company_id}`,
  );
  line(`Period: ${invoice.period_start} to ${invoice.period_end}`);
  line(`Due: ${invoice.due_at ?? "On receipt"}`);
  line(`Status: ${invoice.status}`);
  y -= 20;
  for (const item of (invoice.invoice_items ?? []) as unknown as Record<
    string,
    unknown
  >[])
    line(
      `${item.description} | ${item.quantity} x ${item.unit_price} ${invoice.currency} | Tax ${item.tax_percent}%`,
    );
  y -= 20;
  line(`Subtotal: ${invoice.subtotal} ${invoice.currency}`);
  line(`Tax: ${invoice.tax} ${invoice.currency}`);
  line(`Total: ${invoice.total} ${invoice.currency}`, 18);
  return pdf.save();
}
