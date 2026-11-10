import { NextResponse } from "next/server";
import { serverDatabase } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(next) ? next : "/";
  if (code) {
    const db = await serverDatabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext, process.env.APP_URL ?? url.origin),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=verification", process.env.APP_URL ?? url.origin),
  );
}
