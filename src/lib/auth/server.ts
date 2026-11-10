import "server-only";
import { serverDatabase } from "../supabase/server";
import { AppError, databaseError } from "../errors";
import { hasPermission } from "./permissions";
import type { Permission, UserContext } from "../types";
import { isDemoData } from "../data-mode";
export async function authenticated(permission?: Permission) {
  const db = await serverDatabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new AppError("UNAUTHORIZED", 401);
  const result = await db.rpc("my_context");
  databaseError(result.error);
  const context = result.data as UserContext | null;
  if (!context || context.suspended) throw new AppError("FORBIDDEN", 403);
  if (!context.platform_role) {
    const company = await db
      .from("companies")
      .select("id")
      .eq("is_seed", isDemoData())
      .eq(
        "id",
        context.membership?.company_id ??
          "00000000-0000-0000-0000-000000000000",
      )
      .maybeSingle();
    if (!company.data) throw new AppError("COMPANY_INACTIVE", 403);
  }
  if (permission && !hasPermission(context, permission))
    throw new AppError("FORBIDDEN", 403);
  return { db, context, user };
}
export async function administrator(permission: Permission) {
  const auth = await authenticated(permission);
  if (!auth.context.platform_role) throw new AppError("FORBIDDEN", 403);
  return auth;
}
