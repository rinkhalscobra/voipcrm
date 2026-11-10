import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderAccount, SyncJob } from "../types";
import { TelTelClient } from "./teltel-client";
import { decryptCredential, scrubProviderPayload } from "../security/crypto";
import { AppError, databaseError } from "../errors";
import { log } from "../logging";

export function utcProviderTime(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const time = new Date(normalized);
  if (!Number.isFinite(time.getTime()))
    throw new AppError("PROVIDER_SCHEMA", 502);
  return time.toISOString();
}
export async function executeSync(db: SupabaseClient, job: SyncJob) {
  const start = Date.now();
  const accountResult = await db
    .from("provider_accounts")
    .select("*")
    .eq("id", job.provider_account_id)
    .single();
  databaseError(accountResult.error);
  const account = accountResult.data as ProviderAccount;
  if (account.status === "disabled" || account.is_seed)
    throw new AppError("NOT_FOUND", 404);
  const checkLease = async () => {
    const result = await db.rpc("renew_sync_lease", {
      p_id: job.id,
      p_token: job.lease_token,
    });
    databaseError(result.error);
    if (!result.data) throw new AppError("LEASE_LOST", 409);
  };
  const sync = await db
    .from("provider_api_syncs")
    .insert({
      provider_account_id: account.id,
      resource: job.resource,
      status: "running",
    })
    .select("id")
    .single();
  databaseError(sync.error);
  const heartbeat = setInterval(() => {
    void checkLease().catch(() =>
      log("worker.lease_heartbeat_failed", {
        jobId: job.id,
        code: "LEASE_HEARTBEAT_FAILED",
      }),
    );
  }, 20000);
  heartbeat.unref();
  let count = 0;
  try {
    await checkLease();
    const secret = await db.rpc("worker_provider_secret", { p_id: account.id });
    databaseError(secret.error);
    let apiKey: string;
    try {
      apiKey = decryptCredential(String(secret.data), account.id);
    } catch {
      throw new AppError("CREDENTIAL_DECRYPTION_ERROR", 503);
    }
    const client = new TelTelClient({ accountId: account.id, apiKey });
    if (job.resource === "balance") {
      const balance = await client.balance();
      await checkLease();
      databaseError(
        (
          await db
            .from("provider_accounts")
            .update({
              balance: balance.balance,
              credit: balance.credit,
              credit_limit: balance.credit_limit,
              balance_updated_at: new Date().toISOString(),
            })
            .eq("id", account.id)
        ).error,
      );
      count = 1;
    } else if (job.resource === "calls") {
      // A bounded rolling window is explicit. Historical backfill is a separate operational task.
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const until = new Date().toISOString();
      const calls = await client.calls(since, until);
      await checkLease();
      for (const call of calls) {
        await checkLease();
        const identity =
          call.direction === "outbound"
            ? call.caller.cid
            : call.direction === "inbound"
              ? (call.caller.dnid ?? call.callee.number)
              : null;
        databaseError(
          (
            await db.rpc("import_call", {
              p_provider: account.id,
              p_call: call.call_id,
              p_origin: call.caller.number ?? null,
              p_destination: call.callee.number ?? null,
              p_start: utcProviderTime(call.starttime),
              p_end: utcProviderTime(call.stoptime),
              p_duration: call.duration_sec ?? null,
              p_direction: call.direction,
              p_status: call.status,
              p_cost: call.cost ?? null,
              p_raw: scrubProviderPayload(call),
              p_identity: identity ?? null,
            })
          ).error,
        );
        count++;
      }
    } else {
      const rows: Record<string, unknown>[] = [];
      let table: string;
      const timestamp = new Date().toISOString();
      if (job.resource === "users") {
        table = "provider_users";
        for (const user of await client.users())
          rows.push({
            provider_account_id: account.id,
            provider_resource_id: user.id,
            name: user.realname ?? user.name,
            raw: scrubProviderPayload(user),
            synced_at: timestamp,
          });
      } else if (job.resource === "devices") {
        table = "provider_devices";
        for (const device of await client.devices())
          rows.push({
            provider_account_id: account.id,
            provider_resource_id: device.name,
            provider_user_resource_id: device.user_id ?? null,
            raw: scrubProviderPayload(device),
            synced_at: timestamp,
          });
      } else if (job.resource === "dids") {
        table = "did_numbers";
        for (const did of await client.dids())
          rows.push({
            provider_account_id: account.id,
            provider_resource_id: did.id,
            number: did.did,
            country: did.country_name ?? null,
            provider_status: did.activated === 1 ? "active" : "inactive",
            wholesale_monthly: did.monthly_price ?? null,
            renewal_at: did.next_payment_date ?? null,
            raw: scrubProviderPayload(did),
            synced_at: timestamp,
          });
      } else {
        table = "provider_user_statuses";
        for (const status of await client.statuses())
          rows.push({
            provider_account_id: account.id,
            provider_resource_id: status.id,
            name: status.name,
            enabled: status.enabled,
            is_offline: status.is_offline,
            raw: scrubProviderPayload(status),
          });
      }
      await checkLease();
      for (let i = 0; i < rows.length; i += 200) {
        await checkLease();
        databaseError(
          (
            await db.from(table).upsert(rows.slice(i, i + 200), {
              onConflict: "provider_account_id,provider_resource_id",
            })
          ).error,
        );
      }
      count = rows.length;
    }
    await checkLease();
    // Separate resources complete independently; read current verification to avoid overwriting another job's progress.
    databaseError(
      (
        await db.rpc("mark_provider_resource_verified", {
          p_provider: account.id,
          p_resource: job.resource,
        })
      ).error,
    );
    databaseError(
      (
        await db
          .from("provider_api_syncs")
          .update({
            status: "completed",
            records: count,
            finished_at: new Date().toISOString(),
          })
          .eq("id", sync.data!.id)
      ).error,
    );
    databaseError(
      (
        await db
          .from("sync_jobs")
          .update({ status: "completed", locked_until: null })
          .eq("id", job.id)
          .eq("lease_token", job.lease_token)
      ).error,
    );
    log("provider.sync_completed", {
      providerId: account.id,
      jobId: job.id,
      resource: job.resource,
      count,
      durationMs: Date.now() - start,
    });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "SYNC_FAILED";
    if (code === "LEASE_LOST") {
      log("provider.lease_lost", { jobId: job.id, code });
      return;
    }
    databaseError(
      (
        await db
          .from("provider_api_syncs")
          .update({
            status: "failed",
            error_code: code,
            finished_at: new Date().toISOString(),
          })
          .eq("id", sync.data!.id)
      ).error,
    );
    await db
      .from("provider_accounts")
      .update({ last_error_code: code })
      .eq("id", account.id);
    await db
      .from("provider_api_errors")
      .insert({ provider_account_id: account.id, code });
    await db
      .from("sync_jobs")
      .update({
        status: job.attempts >= 5 ? "failed" : "pending",
        locked_until: null,
        last_error_code: code,
        run_after: new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
        ).toISOString(),
      })
      .eq("id", job.id)
      .eq("lease_token", job.lease_token);
    await db.from("notifications").insert({
      title: "Provider synchronization failed",
      message: `Resource: ${job.resource}. Error code: ${code}.`,
      severity: "error",
    });
    log("provider.sync_failed", {
      providerId: account.id,
      jobId: job.id,
      code,
    });
  } finally {
    clearInterval(heartbeat);
  }
}
