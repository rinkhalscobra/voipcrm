import { serviceDatabase } from "../supabase/server";
import { decryptCredential } from "../security/crypto";
import { AppError, databaseError } from "../errors";
import { TelTelClient } from "./teltel-client";
import { isDemoData } from "../data-mode";
export async function providerClient(providerId: string) {
  if (isDemoData()) throw new AppError("DEMO_PROVIDER_DISABLED", 409);
  const db = serviceDatabase();
  const account = await db
    .from("provider_accounts")
    .select("id,status,is_seed")
    .eq("id", providerId)
    .maybeSingle();
  databaseError(account.error);
  if (
    !account.data ||
    account.data.status === "disabled" ||
    account.data.is_seed
  )
    throw new AppError("NOT_FOUND", 404);
  const secret = await db.rpc("worker_provider_secret", { p_id: providerId });
  databaseError(secret.error);
  if (!secret.data) throw new AppError("PROVIDER_AUTH", 502);
  return new TelTelClient({
    accountId: providerId,
    apiKey: decryptCredential(String(secret.data), providerId),
  });
}
