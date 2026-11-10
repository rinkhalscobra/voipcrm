import { AuthForm } from "@/components/auth-form";
import { isConfigured } from "@/lib/supabase/server";
export default function LoginPage() {
  return <AuthForm configured={isConfigured()} />;
}
