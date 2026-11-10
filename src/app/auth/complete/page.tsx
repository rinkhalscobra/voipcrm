"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserDatabase } from "@/lib/supabase/browser";
import { Brand } from "@/components/brand";
export default function CompleteAuthPage() {
  const [error, setError] = useState("");
  const processing = useRef(false);
  useEffect(() => {
    if (processing.current) return;
    processing.current = true;
    void (async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const access_token = params.get("access_token"),
        refresh_token = params.get("refresh_token");
      window.history.replaceState({}, "", window.location.pathname);
      if (access_token && refresh_token) {
        const result = await browserDatabase().auth.setSession({
          access_token,
          refresh_token,
        });
        if (!result.error) {
          window.location.replace("/auth/password");
          return;
        }
      } else {
        const { data } = await browserDatabase().auth.getSession();
        if (data.session) {
          window.location.replace("/auth/password");
          return;
        }
      }
      setError(
        "This verification link is incomplete or has expired. Request a password reset to receive a fresh link.",
      );
    })().catch(() =>
      setError(
        "The verification link could not be completed. Request a new password reset link.",
      ),
    );
  }, []);
  return (
    <main className="standalone">
      <Brand />
      <span className="eyebrow">SECURE ACCOUNT SETUP</span>
      <h1>
        {error
          ? "A fresh verification link is needed"
          : "Completing your account setup…"}
      </h1>
      {error && (
        <>
          <p role="alert">{error}</p>
          <Link href="/auth/reset">Request a password reset →</Link>
        </>
      )}
    </main>
  );
}
