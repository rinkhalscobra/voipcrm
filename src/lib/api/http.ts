import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, publicMessages } from "../errors";
import { log } from "../logging";
export function ok(
  data: unknown,
  meta?: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(
    { data, ...(meta ? { meta } : {}) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function body<T>(request: Request, schema: z.ZodType<T>) {
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    throw new AppError("INVALID_REQUEST", 413);
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 65536) throw new Error();
    raw = JSON.parse(text);
  } catch {
    throw new AppError("INVALID_REQUEST", 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new AppError(
      "INVALID_REQUEST",
      400,
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export function guardOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = new URL(process.env.APP_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new AppError("FORBIDDEN", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("INVALID_REQUEST", 415);
}
export function failure(error: unknown) {
  const requestId = crypto.randomUUID();
  const app =
    error instanceof AppError ? error : new AppError("INTERNAL_ERROR", 500);
  log("api.failed", { requestId, code: app.code });
  return NextResponse.json(
    {
      error: {
        code: app.code,
        message:
          app.code === "INVALID_REQUEST" && app.message !== app.code
            ? app.message
            : (publicMessages[app.code] ?? publicMessages.INTERNAL_ERROR),
        requestId,
      },
    },
    { status: app.status, headers: { "Cache-Control": "no-store" } },
  );
}
export const uuid = z.string().uuid();
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const money = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
