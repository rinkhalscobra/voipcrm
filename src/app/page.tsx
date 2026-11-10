import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/supabase/server";
import { authenticated } from "@/lib/auth/server";
import { homeFor } from "@/lib/auth/permissions";
export default async function Home() {
  if (!isConfigured()) redirect("/admin");
  let destination = "/login";
  try {
    destination = homeFor((await authenticated()).context);
  } catch {
    destination = "/login";
  }
  redirect(destination);
}
