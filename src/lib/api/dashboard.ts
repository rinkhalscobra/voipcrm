import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseError } from "../errors";
import { safeCallColumns } from "./queries";
import { isDemoData } from "../data-mode";
export async function dashboard(
  db: SupabaseClient,
  admin: boolean,
  finance: boolean,
  days: number,
  clientId?: string,
) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [
    companies,
    numbers,
    calls,
    providers,
    wallets,
    users,
    jobs,
    invoices,
    clientBilling,
  ] = await Promise.all([
    admin
      ? db
          .from("companies")
          .select("id,name,status,currency")
          .eq("is_seed", isDemoData())
      : db
          .from("companies")
          .select("id,name,status,currency")
          .eq("is_seed", isDemoData()),
    admin
      ? db
          .from("did_numbers")
          .select("id", { count: "exact", head: true })
          .eq("provider_status", "active")
          .eq("is_seed", isDemoData())
      : db.rpc("my_numbers", {}, { count: "exact", head: true }),
    db
      .from("calls")
      .select(
        admin && finance ? `${safeCallColumns},provider_cost` : safeCallColumns,
        { count: "exact" },
      )
      .gte("started_at", since)
      .eq("is_seed", isDemoData())
      .order("started_at", { ascending: false })
      .limit(1000),
    admin
      ? db
          .from("provider_accounts")
          .select(
            "id,name,status,currency,balance,balance_updated_at,last_successful_sync,last_error_code,verified_resources,is_seed",
          )
          .eq("is_seed", isDemoData())
      : Promise.resolve({ data: [], error: null }),
    finance || clientId
      ? db
          .from("client_wallets")
          .select("id,company_id,currency,balance,suspended")
          .eq("is_seed", isDemoData())
      : Promise.resolve({ data: [], error: null }),
    admin
      ? db
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .or(`is_seed.eq.${isDemoData()},platform_role.not.is.null`)
      : db
          .from("company_memberships")
          .select("id", { count: "exact", head: true })
          .eq("is_seed", isDemoData()),
    admin
      ? db
          .from("sync_jobs")
          .select("id,status")
          .in("status", ["pending", "running", "failed"])
          .eq("is_seed", isDemoData())
      : Promise.resolve({ data: [], error: null }),
    finance
      ? db
          .from("invoices")
          .select("id,status,total,currency")
          .neq("status", "void")
          .eq("is_seed", isDemoData())
      : Promise.resolve({ data: [], error: null }),
    clientId
      ? db.rpc("client_balance_overview", { p_client: clientId })
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [
    companies,
    numbers,
    calls,
    providers,
    wallets,
    users,
    jobs,
    invoices,
    clientBilling,
  ])
    databaseError(result.error);
  return {
    companies: companies.data ?? [],
    numberCount: (numbers as { count?: number }).count ?? 0,
    calls: calls.data ?? [],
    callCount: calls.count ?? 0,
    callsTruncated: (calls.count ?? 0) > 1000,
    providers: providers.data ?? [],
    wallets: wallets.data ?? [],
    userCount: users.count ?? 0,
    jobs: jobs.data ?? [],
    invoices: invoices.data ?? [],
    clientBilling: clientBilling.data ?? null,
    periodDays: days,
    generatedAt: new Date().toISOString(),
  };
}
