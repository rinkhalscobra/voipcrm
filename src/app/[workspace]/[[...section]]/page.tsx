import { notFound, redirect } from "next/navigation";
import { isConfigured } from "@/lib/supabase/server";
import { authenticated } from "@/lib/auth/server";
import { homeFor } from "@/lib/auth/permissions";
import { Workspace } from "@/components/workspace";
import { isDemoData } from "@/lib/data-mode";
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string; section?: string[] }>;
}) {
  const { workspace, section = [] } = await params;
  if (
    ![
      "admin",
      "company",
      "manager",
      "team-leader",
      "agent",
      "client",
      "dialer",
    ].includes(workspace)
  )
    notFound();
  const configured = isConfigured();
  let context = null;
  if (configured) {
    let target: string | undefined;
    try {
      context = (await authenticated()).context;
    } catch {
      target = "/login";
    }
    if (target) redirect(target);
    if (
      context &&
      workspace !== "dialer" &&
      homeFor(context).slice(1) !== workspace
    )
      redirect(homeFor(context));
    if (
      context?.membership?.role === "client" &&
      workspace !== "dialer" &&
      ![
        "",
        "numbers",
        "wallet",
        "calls",
        "reports",
        "notifications",
        "settings",
        "profile",
        "dialer",
      ].includes(section[0] ?? "")
    )
      notFound();
  } else if (workspace !== "admin") redirect("/admin");
  return (
    <Workspace
      configured={configured}
      demo={isDemoData()}
      context={context}
      workspace={workspace}
      section={workspace === "dialer" ? ["dialer"] : section}
    />
  );
}
