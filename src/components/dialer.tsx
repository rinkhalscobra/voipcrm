"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Info, Phone, PhoneCall, Star, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  type Row,
  str,
  relation,
} from "./shared";
import type { Action } from "./action-dialog";
export function Dialer({
  configured,
  base,
  notify,
  openAction,
}: {
  configured: boolean;
  base: string;
  notify: (s: string) => void;
  openAction: (a: Action) => void;
}) {
  const [number, setNumber] = useState(""),
    [identity, setIdentity] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const identities = useQuery({
    queryKey: ["dialer", "identities"],
    queryFn: () => api<Row[]>("dialer/identities"),
    enabled: configured,
  });
  const recent = useQuery({
    queryKey: ["dialer", "calls"],
    queryFn: () => api<Row[]>(`${base}/calls`),
    enabled: configured,
  });
  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api<Row[]>("favorites"),
    enabled: configured && base !== "admin",
  });
  const mutation = useMutation({
    mutationFn: () =>
      api("calls/click2call", {
        method: "POST",
        data: {
          identity_id: identity,
          destination: number,
          idempotency_key: requestKey,
        },
      }),
    onSuccess: () => {
      setSubmitted(true);
      notify("Callback request submitted. Check your authorized SIP device.");
    },
  });
  const changeNumber = (value: string) => {
    setNumber(value);
    setSubmitted(false);
    setRequestKey(crypto.randomUUID());
  };
  return (
    <>
      <div className="notice">
        <Info size={15} />
        <span>
          Click2Call rings your authorized device and connects the destination.
          Browser audio and live call states require a separately supported
          WebPhone or event integration.
        </span>
      </div>
      <div className="dialer-layout">
        <section className="panel dialer-card">
          <span className="eyebrow">CLICK2CALL</span>
          <h2>Make a call</h2>
          <p>Use a verified calling identity and an allowed destination.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <label className="form-field">
              Calling identity
              <Select
                aria-label="Calling identity"
                placeholder="Select an authorized identity"
                emptyMessage="No authorized identities available"
                required
                value={identity}
                onValueChange={(value) => {
                  setIdentity(value);
                  setRequestKey(crypto.randomUUID());
                }}
                options={(identities.data?.data ?? []).map((i) => ({
                  value: str(i, "id"),
                  label: str(
                    relation(relation(i, "did_allocations"), "did_numbers"),
                    "number",
                  ),
                }))}
              />
            </label>
            <Input
              className="dialer-number"
              type="tel"
              inputMode="tel"
              value={number}
              onChange={(e) => changeNumber(e.target.value)}
              pattern="\+[1-9][0-9]{6,14}"
              placeholder="+49 30 1234 5678"
              required
              aria-label="Destination phone number"
            />
            <div className="form-hint">
              International format, including + and country code. No spaces.
            </div>
            <div className="dialpad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"].map(
                (key, i) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={
                      key === "⌫" ? "Delete last digit" : `Dial ${key}`
                    }
                    onClick={() =>
                      changeNumber(
                        key === "⌫" ? number.slice(0, -1) : number + key,
                      )
                    }
                  >
                    {key}
                    <small>
                      {
                        [
                          "",
                          "ABC",
                          "DEF",
                          "GHI",
                          "JKL",
                          "MNO",
                          "PQRS",
                          "TUV",
                          "WXYZ",
                          "",
                          "",
                          "",
                        ][i]
                      }
                    </small>
                  </button>
                ),
              )}
            </div>
            {mutation.error && <ErrorBanner error={mutation.error} />}
            <Button
              className="dial-submit"
              type="submit"
              disabled={
                !configured || !identity || mutation.isPending || submitted
              }
            >
              <Phone size={16} />
              {mutation.isPending
                ? "Submitting request…"
                : submitted
                  ? "Request submitted"
                  : "Call destination"}
            </Button>
            {!identities.data?.data.length && (
              <p className="form-hint" style={{ marginTop: 15 }}>
                No verified calling identity is available. Ask your
                administrator to map an employee, device, and authorized DID.
              </p>
            )}
          </form>
        </section>
        <div>
          <section className="panel" style={{ marginBottom: 22 }}>
            <div className="panel-heading">
              <div>
                <h2>Favorite contacts</h2>
                <p>Saved in your private workspace</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={!configured || base === "admin"}
                onClick={() =>
                  openAction({
                    title: "Save a favorite contact",
                    description: "Only your account can access this contact.",
                    endpoint: "favorites",
                    fields: [
                      { name: "name", label: "Contact name" },
                      {
                        name: "number",
                        label: "International phone number",
                        placeholder: "+493012345678",
                      },
                    ],
                  })
                }
              >
                <Star size={13} />
                Add contact
              </Button>
            </div>
            {favorites.data?.data.length ? (
              favorites.data.data.map((f) => (
                <div className="provider-row" key={str(f, "id")}>
                  <div className="provider-icon">
                    <Star size={15} />
                  </div>
                  <div>
                    <strong>{str(f, "name")}</strong>
                    <small>{str(f, "number")}</small>
                  </div>
                  <Button
                    style={{ marginLeft: "auto" }}
                    size="sm"
                    variant="ghost"
                    onClick={() => changeNumber(str(f, "number"))}
                  >
                    Use number
                    <ArrowUpRight size={12} />
                  </Button>
                </div>
              ))
            ) : (
              <EmptyState
                title="Keep your regular contacts close"
                description="Save frequently called numbers for quick access."
                icon={Star}
              />
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recent calls</h2>
                <p>Synchronized records, separate from callback submission</p>
              </div>
              <PhoneCall size={16} color="var(--muted)" />
            </div>
            {recent.error ? (
              <ErrorBanner error={recent.error} />
            ) : recent.data?.data.length ? (
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>DESTINATION</th>
                    <th>TIME</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.data.slice(0, 8).map((c) => (
                    <tr key={str(c, "id")}>
                      <td>{str(c, "destination")}</td>
                      <td>{formatDate(str(c, "started_at"))}</td>
                      <td>
                        <Badge value={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No recent calls"
                description="Your synchronized call history will appear here."
                icon={PhoneCall}
              />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
