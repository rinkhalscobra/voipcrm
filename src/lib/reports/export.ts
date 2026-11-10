import { NextResponse } from "next/server";
const columns = [
  "id",
  "started_at",
  "origin",
  "destination",
  "direction",
  "duration_seconds",
  "talk_seconds",
  "status",
  "customer_charge",
  "currency",
];
export function safeSpreadsheetValue(value: unknown) {
  const raw = value == null ? "" : String(value);
  return /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
}
export function csvCell(value: unknown) {
  return `"${safeSpreadsheetValue(value).replaceAll('"', '""')}"`;
}
export async function exportCalls(
  rows: Record<string, unknown>[],
  format: "csv" | "xlsx",
  demo = false,
) {
  const exportColumns = demo ? ["data_mode", ...columns] : columns;
  const exportRows: Record<string, unknown>[] = demo
    ? rows.map((row) => ({ ...row, data_mode: "DEMO · SYNTHETIC DATA" }))
    : rows;
  if (format === "csv") {
    const csv = [
      exportColumns.map(csvCell).join(","),
      ...exportRows.map((row) =>
        exportColumns.map((key) => csvCell(row[key])).join(","),
      ),
    ].join("\r\n");
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="calls${demo ? "-demo" : ""}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const platformName = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel";
  workbook.creator = platformName;
  workbook.lastModifiedBy = platformName;
  workbook.title = `${platformName} · Call report`;
  const sheet = workbook.addWorksheet(demo ? "Demo calls" : "Calls");
  sheet.addRow(exportColumns);
  for (const row of exportRows)
    sheet.addRow(exportColumns.map((key) => safeSpreadsheetValue(row[key])));
  const bytes = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="calls${demo ? "-demo" : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
