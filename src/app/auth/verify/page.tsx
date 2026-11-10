import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { isConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return <AuthForm configured={isConfigured()} mode="verify" />;
}
