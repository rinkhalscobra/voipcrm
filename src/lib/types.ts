export type TenantRole =
  "company_admin" | "manager" | "team_leader" | "agent" | "client";
export type PlatformRole = "super_admin" | "platform_admin";
export type Permission =
  | "companies.manage"
  | "providers.manage"
  | "numbers.manage"
  | "calls.read"
  | "calls.initiate"
  | "users.manage"
  | "teams.manage"
  | "finance.read"
  | "finance.write"
  | "reports.export"
  | "audit.read"
  | "settings.manage"
  | "pricing.manage";
export interface Membership {
  id: string;
  company_id: string;
  user_id: string;
  role: TenantRole;
  manager_id: string | null;
  team_leader_id: string | null;
  active: boolean;
}
export interface UserContext {
  id: string;
  full_name: string;
  platform_role: PlatformRole | null;
  suspended: boolean;
  membership: Membership | null;
  client?: {
    id: string;
    name: string;
    company_id: string;
    company_name: string;
  } | null;
  permissions: Permission[];
}
export interface ProviderAccount {
  did_numbers?: { count: number }[];
  provider_users?: { count: number }[];
  provider_devices?: { count: number }[];
  id: string;
  name: string;
  currency: string;
  status: string;
  balance: string | number | null;
  credit: string | number | null;
  credit_limit: string | number | null;
  balance_updated_at: string | null;
  last_successful_sync: string | null;
  last_error_code: string | null;
  verified_resources: string[];
  is_seed: boolean;
}
export type SyncResource =
  "balance" | "users" | "devices" | "dids" | "calls" | "statuses";
export interface SyncJob {
  id: string;
  provider_account_id: string;
  resource: SyncResource;
  attempts: number;
  lease_token: string;
}
export interface ApiErrorPayload {
  error: { code: string; message: string; requestId: string };
}
export type DataRow = Record<
  string,
  string | number | boolean | null | string[] | Record<string, unknown>
>;
