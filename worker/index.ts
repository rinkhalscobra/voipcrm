import { createClient } from "@supabase/supabase-js";
import { executeSync } from "../src/lib/providers/sync";
import { log } from "../src/lib/logging";
import type { SyncJob } from "../src/lib/types";
import { isDemoData } from "../src/lib/data-mode";
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.PROVIDER_ENCRYPTION_KEY
)
  throw new Error("Worker environment is incomplete");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let stopping = false,
  lastSchedule = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
log(
  isDemoData() ? "worker.demo_mode_provider_sync_disabled" : "worker.started",
);
while (!stopping) {
  try {
    if (isDemoData()) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    if (
      Date.now() - lastSchedule >
      Number(process.env.WORKER_SYNC_INTERVAL_SECONDS ?? 300) * 1000
    ) {
      const { data: accounts, error } = await db
        .from("provider_accounts")
        .select("id")
        .in("status", ["active", "pending_verification", "error"])
        .eq("is_seed", false);
      if (error) throw error;
      for (const account of accounts ?? []) {
        const { error: enqueueError } = await db
          .from("sync_jobs")
          .insert(
            ["balance", "users", "devices", "dids", "calls", "statuses"].map(
              (resource) => ({ provider_account_id: account.id, resource }),
            ),
          );
        // The partial unique index deduplicates already queued resources; insert individually after conflict.
        if (enqueueError?.code === "23505")
          for (const resource of [
            "balance",
            "users",
            "devices",
            "dids",
            "calls",
            "statuses",
          ])
            await db
              .from("sync_jobs")
              .insert({ provider_account_id: account.id, resource });
      }
      lastSchedule = Date.now();
    }
    const { data, error } = await db.rpc("claim_sync_job");
    if (error) throw error;
    const job = (data as SyncJob[] | null)?.[0];
    if (job) await executeSync(db, job);
    const billing = await db.rpc("process_client_billing", { p_limit: 100 });
    if (billing.error) {
      log("client.billing_failed", { code: "BILLING_ERROR" });
      throw new Error("BILLING_ERROR");
    }
    if (Number(billing.data?.processed ?? 0) > 0)
      log("client.billing_completed", {
        count: Number(billing.data.processed),
      });
    if (!job && !Number(billing.data?.processed ?? 0))
      await new Promise((resolve) =>
        setTimeout(resolve, Number(process.env.WORKER_POLL_MS ?? 5000)),
      );
  } catch {
    log("worker.loop_failed", { code: "WORKER_ERROR" });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
log("worker.stopped");
