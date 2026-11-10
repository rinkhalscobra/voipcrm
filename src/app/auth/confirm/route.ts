import { NextResponse } from "next/server";
import { serverDatabase } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
export async function GET(request: Request) {
  const url = new URL(request.url),
    token_hash = url.searchParams.get("token_hash"),
    type = url.searchParams.get("type");
  // Older Supabase email templates redirect with tokens in the URL fragment.
  // Browsers preserve that fragment across this same-origin redirect; only the client can read it.
  if (!token_hash)
    return NextResponse.redirect(
      new URL("/auth/complete", process.env.APP_URL ?? url.origin),
    );
  if (token_hash && type && ["invite", "recovery", "email"].includes(type)) {
    const db = await serverDatabase();
    const { error } = await db.auth.verifyOtp({
      token_hash,
      type: type as EmailOtpType,
    });
    if (!error)
      return NextResponse.redirect(
        new URL(
          type === "invite" || type === "recovery" ? "/auth/password" : "/",
          process.env.APP_URL ?? url.origin,
        ),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=verification", process.env.APP_URL ?? url.origin),
  );
}
