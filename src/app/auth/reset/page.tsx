import { AuthForm } from "@/components/auth-form";
import { isConfigured } from "@/lib/supabase/server";
export default function ResetPage() {
  return <AuthForm configured={isConfigured()} mode="reset" />;
}
