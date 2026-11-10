"use client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  relation,
  str,
  type Row,
} from "./shared";
import type { Action } from "./action-dialog";
export function WalletsPage({
  configured,
  base,
  canWrite,
  openAction,
  companyFilter,
}: {
  configured: boolean;
  base: string;
  canWrite: boolean;
  openAction: (a: Action) => void;
  companyFilter?: string;
}) {
  const query = useQuery({
    queryKey: [base, "wallets", companyFilter],
    queryFn: () =>
      api<{ wallets: Row[]; transactions: Row[] }>(
        `${base}/${base === "admin" ? "wallets" : "wallet"}${companyFilter ? `?company=${companyFilter}` : ""}`,
      ),
    enabled: configured,
  });
  const wallets = query.data?.data.wallets ?? [],
    transactions = query.data?.data.transactions ?? [];
  function adjust(wallet: Row, type: "credit" | "debit") {
    openAction({
      title: type === "credit" ? "Add wallet credit" : "Debit wallet",
      description:
        "This changes the customer’s internal prepaid balance. An immutable ledger entry and audit event are created atomically. Upstream balances are unaffected.",
      endpoint: `admin/wallets/${wallet.id}/${type}`,
      fields: [
        {
          name: "amount",
          label: `Amount (${wallet.currency})`,
          type: "number",
          min: "0.000001",
          step: "0.000001",
        },
        { name: "reason", label: "Reason or payment reference" },
      ],
      transform: (d) => ({
        amount: d.amount,
        reason: d.reason,
        idempotency_key: d.idempotency_key,
      }),
      submit: type === "credit" ? "Add credit" : "Confirm debit",
    });
  }
  return (
    <>
      <div className="notice">
        <ShieldCheck size={15} />
        Customer balances are backed by an immutable transaction ledger. Each
        currency is kept separate. A wallet credit does not imply a received
        payment unless you have verified it.
      </div>
      {query.error && (
        <ErrorBanner error={query.error} retry={() => query.refetch()} />
      )}
      {query.isPending && configured ? (
        <LoadingRows />
      ) : wallets.length ? (
        <div className="wallet-summary">
          {wallets.map((w) => (
            <section className="panel wallet-card" key={str(w, "id")}>
              <div className="metric-title">
                <Wallet size={15} />
                {str(relation(w, "companies"), "name")}
                <span style={{ marginLeft: "auto" }}>
                  <Badge value={w.suspended ? "suspended" : "active"} />
                </span>
              </div>
              <div className="metric-value">
                {formatMoney(String(w.balance), str(w, "currency"))}
              </div>
              <span className="subtle-label">
                Available prepaid balance · {str(w, "currency")}
              </span>
              {canWrite && (
                <div className="heading-actions">
                  <Button size="sm" onClick={() => adjust(w, "credit")}>
                    <Plus size={12} />
                    Add credit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => adjust(w, "debit")}
                  >
                    <ArrowUpRight size={12} />
                    Debit
                  </Button>
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <section className="panel" style={{ marginBottom: 22 }}>
          <EmptyState
            title="No customer wallets yet"
            description={
              configured
                ? "A separate wallet is created with each company. Create a company to get started."
                : "Connect the database to securely manage customer funds."
            }
            icon={Wallet}
          />
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Transaction ledger</h2>
            <p>
              Immutable credits, debits, corrections, and rated call charges
            </p>
          </div>
          <ShieldCheck size={16} color="var(--muted)" />
        </div>
        {transactions.length ? (
          <div className="data-table-scroll">
            <table className="mini-table data-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>TYPE</th>
                  <th>AMOUNT</th>
                  <th>BALANCE AFTER</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={str(t, "id")}>
                    <td>{formatDate(str(t, "created_at"))}</td>
                    <td>
                      <Badge value={t.type} />
                    </td>
                    <td
                      style={{
                        color:
                          Number(t.amount) > 0
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {formatMoney(String(t.amount), str(t, "currency"))}
                    </td>
                    <td>
                      {formatMoney(String(t.balance_after), str(t, "currency"))}
                    </td>
                    <td>{str(t, "reason")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No ledger entries"
            description="Wallet operations are recorded here. Balances cannot be edited directly."
          />
        )}
      </section>
    </>
  );
}
