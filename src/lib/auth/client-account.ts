import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContext } from "../types";
import { hasPermission } from "./permissions";
import { isDemoData } from "../data-mode";
import { AppError, databaseError } from "../errors";
import type { ClientAccountInput } from "./client-account-schema";

export async function updateClientAccount(
  service: SupabaseClient,
  context: UserContext,
  clientId: string,
  input: ClientAccountInput,
) {
  if (!context.platform_role || !hasPermission(context, "users.manage"))
    throw new AppError("FORBIDDEN", 403);
  const client = await service
    .from("clients")
    .select("id,user_id,company_id,is_seed")
    .eq("id", clientId)
    .maybeSingle();
  databaseError(client.error);
  if (!client.data || client.data.is_seed !== isDemoData())
    throw new AppError("NOT_FOUND", 404);
  const current = await service.auth.admin.getUserById(client.data.user_id);
  if (current.error || !current.data.user)
    throw new AppError("CLIENT_UPDATE_FAILED", 409);
  const user = current.data.user;
  const email = input.email ?? user.email;
  if (!email) throw new AppError("INVALID_REQUEST");
  async function emailInUse() {
    const conflict = await service.rpc("client_email_in_use", {
      p_email: email,
      p_user: user.id,
    });
    databaseError(conflict.error);
    return conflict.data === true;
  }
  if (email !== user.email && (await emailInUse()))
    throw new AppError("EMAIL_IN_USE", 409);

  // The trusted operation marker makes profile, status, and audit writes part
  // of the Auth transaction. Passwords are sent only to Auth, never metadata.
  const updated = await service.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true,
    ...(input.password ? { password: input.password } : {}),
    ban_duration: input.active ? "none" : "876000h",
    user_metadata: { ...user.user_metadata, full_name: input.name },
    app_metadata: {
      ...user.app_metadata,
      voixel_client_edit: {
        id: crypto.randomUUID(),
        client_id: clientId,
        actor_id: context.id,
        name: input.name,
        email,
        email_changed: email !== user.email,
        active: input.active,
        password_changed: Boolean(input.password),
      },
    },
  });
  if (updated.error || !updated.data.user) {
    const code = updated.error?.code;
    // Account for another account claiming the email after the first check.
    if (email !== user.email && (await emailInUse()))
      throw new AppError("EMAIL_IN_USE", 409);
    if (
      ["email_exists", "email_already_exists", "user_already_exists"].includes(
        code ?? "",
      )
    )
      throw new AppError("EMAIL_IN_USE", 409);
    if (["weak_password", "same_password"].includes(code ?? ""))
      throw new AppError("PASSWORD_REJECTED", 400);
    throw new AppError("CLIENT_UPDATE_FAILED", 409);
  }
  return { id: clientId, user_id: user.id };
}
