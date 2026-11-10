"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  type Row,
} from "./shared";
import type { Action } from "./action-dialog";
import type { ProviderAccount } from "@/lib/types";
export function ProvidersPage({
  configured,
  demo,
  openAction,
  notify,
}: {
  configured: boolean;
  demo: boolean;
  openAction: (a: Action) => void;
  notify: (message: string) => void;
}) {
  const client = useQueryClient(),
    [activity, setActivity] = useState<ProviderAccount | null>(null);
  const query = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => api<ProviderAccount[]>("admin/providers"),
    enabled: configured,
  });
  const logs = useQuery({
    queryKey: ["provider-activity", activity?.id],
    queryFn: () => api<Row[]>(`admin/providers/${activity!.id}/activity`),
    enabled: Boolean(activity),
  });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`admin/providers/${id}/${action}`, { method: "POST", data: {} }),
    onSuccess: async (result, variables) => {
      await client.invalidateQueries();
      notify(
        variables.action === "test"
          ? "Connection verified. Balance retrieved from the provider."
          : "Synchronization queued. The dedicated worker will process each resource.",
      );
    },
  });
  const providers = query.data?.data ?? [],
    canAdd =
      !providers.length ||
      providers.some((p) =>
        ["balance", "users", "devices", "dids", "calls"].every((r) =>
          p.verified_resources.includes(r),
        ),
      );
  const connect: Action = {
    title: "Connect a provider account",
    description:
      "Credentials are encrypted on the server and never returned to the browser. Confirm the account’s currency in the provider portal; the balance response does not supply one.",
    endpoint: "admin/providers",
    fields: [
      {
        name: "name",
        label: "Internal account name",
        placeholder: "Primary operations",
      },
      {
        name: "currency",
        label: "Verified account currency",
        placeholder: "EUR",
      },
      {
        name: "api_key",
        label: "API key",
        type: "password",
        hint: "Transmitted only to your backend and stored with AES-256-GCM encryption.",
      },
    ],
    submit: "Save connection",
  };
  return (
    <>
      <div className="notice">
        <ShieldCheck size={15} />
        <span>
          {demo
            ? "These three accounts contain synthetic sample inventory and balances. All external provider actions are disabled. "
            : ""}
          Verify your first account’s balance, users, devices, DIDs, and calls
          before enabling more accounts. Each account synchronizes
          independently. Provider balances and customer wallets are separate.
        </span>
      </div>
      {query.error && (
        <ErrorBanner error={query.error} retry={() => query.refetch()} />
      )}
      {mutation.error && <ErrorBanner error={mutation.error} />}
      {query.isPending && configured ? (
        <LoadingRows />
      ) : (
        <div className="provider-grid">
          {providers.map((p) => (
            <article className="panel provider-card" key={p.id}>
              <div className="provider-card-top">
                <div className="provider-icon">
                  <Server size={21} />
                </div>
                <Badge value={p.is_seed ? "demo" : p.status} />
              </div>
              <h2>{p.name}</h2>
              <p>
                {p.is_seed
                  ? "Synthetic sample account · no external connection"
                  : "Independent upstream connection"}
              </p>
              <div className="provider-balance">
                {p.balance == null ? "—" : formatMoney(p.balance, p.currency)}
              </div>
              <span className="subtle-label">
                {p.is_seed ? "Synthetic balance" : "Available upstream balance"}{" "}
                · {p.currency}
              </span>
              <div className="provider-details">
                <div>
                  <span>Total DIDs</span>
                  <strong>{p.did_numbers?.[0]?.count ?? 0}</strong>
                </div>
                <div>
                  <span>Provider users</span>
                  <strong>{p.provider_users?.[0]?.count ?? 0}</strong>
                </div>
                <div>
                  <span>Devices</span>
                  <strong>{p.provider_devices?.[0]?.count ?? 0}</strong>
                </div>
                <div>
                  <span>Balance updated</span>
                  <strong>
                    {p.is_seed
                      ? "Demo fixture"
                      : formatDate(p.balance_updated_at)}
                  </strong>
                </div>
                <div>
                  <span>Last successful sync</span>
                  <strong>
                    {p.is_seed
                      ? "Not connected"
                      : formatDate(p.last_successful_sync)}
                  </strong>
                </div>
                <div>
                  <span>Verified resources</span>
                  <strong>{p.verified_resources.length} of 6</strong>
                </div>
                <div>
                  <span>Last API error</span>
                  <strong>{p.last_error_code ?? "None recorded"}</strong>
                </div>
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {["balance", "users", "devices", "dids", "calls"].map((r) => (
                  <span
                    className={`badge ${p.verified_resources.includes(r) ? "green" : ""}`}
                    key={r}
                  >
                    {p.verified_resources.includes(r) && (
                      <CheckCircle2 size={9} />
                    )}
                    {r}
                  </span>
                ))}
              </div>
              <div className="provider-card-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    demo || mutation.isPending || p.status === "disabled"
                  }
                  onClick={() => mutation.mutate({ id: p.id, action: "test" })}
                >
                  {mutation.isPending ? (
                    <LoaderCircle size={12} className="inline-loader" />
                  ) : (
                    <ShieldCheck size={12} />
                  )}
                  Test
                </Button>
                <Button
                  size="sm"
                  disabled={
                    demo || mutation.isPending || p.status === "disabled"
                  }
                  onClick={() => mutation.mutate({ id: p.id, action: "sync" })}
                >
                  <RefreshCw size={12} />
                  Sync all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActivity(p)}
                >
                  Activity
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Replace credentials for ${p.name}`}
                  disabled={demo}
                  onClick={() =>
                    openAction({
                      title: "Replace provider API key",
                      description:
                        "The new key replaces the encrypted credential. No previous key will be displayed.",
                      endpoint: `admin/providers/${p.id}`,
                      method: "PATCH",
                      fields: [
                        {
                          name: "api_key",
                          label: "New API key",
                          type: "password",
                        },
                      ],
                      submit: "Replace key",
                    })
                  }
                >
                  <KeyRound size={13} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={
                    p.status === "disabled"
                      ? "Reconnect provider"
                      : "Disable integration"
                  }
                  disabled={demo}
                  onClick={() =>
                    openAction({
                      title:
                        p.status === "disabled"
                          ? "Reconnect integration"
                          : "Disable integration",
                      description:
                        p.status === "disabled"
                          ? "Resume provider synchronization. Test the connection after reconnecting."
                          : "Pause future synchronization and new platform callback requests. Existing upstream SIP activity is controlled separately by your provider.",
                      endpoint: `admin/providers/${p.id}`,
                      method: "PATCH",
                      fields: [],
                      transform: () => ({
                        status:
                          p.status === "disabled"
                            ? "pending_verification"
                            : "disabled",
                      }),
                      submit:
                        p.status === "disabled"
                          ? "Reconnect"
                          : "Disable integration",
                    })
                  }
                >
                  <Unplug size={14} />
                </Button>
              </div>
            </article>
          ))}
          <article className="panel provider-card connect-card">
            <div className="provider-icon">
              {canAdd ? <Plus size={23} /> : <LockKeyhole size={21} />}
            </div>
            <h3>
              {providers.length
                ? "Add another account"
                : "Connect your first account"}
            </h3>
            <p>
              {canAdd
                ? "Bring your provider balance, inventory, and call records into one secure workspace."
                : "Complete verification of your first account before adding another provider connection."}
            </p>
            <Button
              size="sm"
              disabled={demo || !configured || !canAdd}
              onClick={() => openAction(connect)}
            >
              Connect account <ArrowRight size={13} />
            </Button>
            {!configured && (
              <span className="form-hint">
                Connect Supabase to enable account setup.
              </span>
            )}
          </article>
        </div>
      )}
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Integration capabilities</h2>
            <p>
              Capabilities are enabled only when their request and response
              contracts are confirmed.
            </p>
          </div>
          <CircleHelp size={16} color="var(--muted)" />
        </div>
        <table className="mini-table">
          <thead>
            <tr>
              <th>CAPABILITY</th>
              <th>IMPLEMENTATION</th>
              <th>REQUIREMENT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Balance, users, devices, DIDs, calls</td>
              <td>
                <Badge value="available" />
              </td>
              <td>API credentials and running worker</td>
            </tr>
            <tr>
              <td>Click2Call</td>
              <td>
                <Badge value="controlled" />
              </td>
              <td>
                Verified employee, device, DID pairing and allowed destination
              </td>
            </tr>
            <tr>
              <td>Number purchasing</td>
              <td>
                <Badge value="disabled" />
              </td>
              <td>Confirmed order identification and reconciliation</td>
            </tr>
            <tr>
              <td>Live events & browser softphone</td>
              <td>
                <Badge value="disabled" />
              </td>
              <td>Official event authentication and WebPhone SDK</td>
            </tr>
          </tbody>
        </table>
      </section>
      <Dialog
        open={Boolean(activity)}
        onOpenChange={(v) => {
          if (!v) setActivity(null);
        }}
      >
        {activity && (
          <DialogContent
            title={`${activity.name} · Activity`}
            description="Synchronization results from the persistent worker."
          >
            {logs.error ? (
              <ErrorBanner error={logs.error} />
            ) : logs.isPending ? (
              <LoadingRows />
            ) : logs.data?.data.length ? (
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>RESOURCE</th>
                    <th>STATUS</th>
                    <th>RECORDS</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.data.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.resource)}</td>
                      <td>
                        <Badge value={row.status} />
                      </td>
                      <td>{String(row.records)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No sync activity yet"
                description="Queue a synchronization and run the dedicated worker to import provider resources."
              />
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
