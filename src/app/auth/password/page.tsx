import { AuthForm } from "@/components/auth-form";
import { isConfigured } from "@/lib/supabase/server";
export default function PasswordPage() {
  return <AuthForm configured={isConfigured()} mode="password" />;
}
