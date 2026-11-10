import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseError } from "../errors";
import { isDemoData } from "../data-mode";
export const safeCallColumns =
  "id,company_id,user_id,manager_id,team_leader_id,origin,destination,started_at,ended_at,duration_seconds,talk_seconds,direction,status,customer_charge,currency,billing_status,synced_at";
export async function queryRows(
  db: SupabaseClient,
  table: string,
  select: string,
  options: {
    page?: number;
    pageSize?: number;
    order?: string;
    companyId?: string;
    companyColumn?: string;
    search?: string;
    searchColumn?: string;
    from?: string;
    to?: string;
    status?: string;
    provider?: string;
    excludeRole?: string;
  } = {},
) {
  const size = options.pageSize ?? 25,
    page = options.page ?? 1;
  let query = db
    .from(table)
    .select(select, { count: "exact" })
    .order(options.order ?? "created_at", { ascending: false })
    .range((page - 1) * size, page * size - 1);
  query = query.order("id", { ascending: true });
  query = query.eq("is_seed", isDemoData());
  if (options.excludeRole) query = query.neq("role", options.excludeRole);
  if (options.companyId)
    query = query.eq(options.companyColumn ?? "company_id", options.companyId);
  if (options.search && options.searchColumn)
    query = query.ilike(
      options.searchColumn,
      `%${options.search.replace(/[%_\\]/g, "")}%`,
    );
  if (options.from) query = query.gte("started_at", options.from);
  if (options.to) query = query.lt("started_at", options.to);
  if (options.status) query = query.eq("status", options.status);
  if (options.provider)
    query = query.eq("provider_account_id", options.provider);
  const result = await query;
  databaseError(result.error);
  return {
    rows: (result.data ?? []) as unknown as Record<string, unknown>[],
    total: result.count ?? 0,
    page,
    pageSize: size,
  };
}
