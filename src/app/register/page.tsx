import { AuthForm } from "@/components/auth-form";
import { isConfigured } from "@/lib/supabase/server";
export default function RegisterPage() {
  return <AuthForm configured={isConfigured()} mode="register" />;
}
