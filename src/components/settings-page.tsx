"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Database, LockKeyhole } from "lucide-react";
import { api } from "@/lib/api/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ErrorBanner, SubmitButton, type Row } from "./shared";
import { ThemePicker } from "./theme-controls";
export function SettingsPage({
  configured,
  notify,
  openSetup,
  admin,
}: {
  configured: boolean;
  notify: (s: string) => void;
  openSetup: () => void;
  admin: boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Row[]>("admin/settings"),
    enabled: configured && admin,
  });
  const [branding, setBranding] = useState({
    platform_name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel",
    support_email: "",
    timezone: "Europe/Berlin",
    default_currency: "",
  });
  useEffect(() => {
    const saved = query.data?.data.find((r) => r.key === "branding")?.value as
      typeof branding | undefined;
    if (saved) setBranding(saved);
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: () => api("admin/settings", { method: "POST", data: branding }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["settings"] });
      notify("Workspace settings saved.");
    },
  });
  return (
    <div className="settings-grid">
      <ThemePicker />
      {query.error && <ErrorBanner error={query.error} />}
      <section className="panel settings-panel">
        <h2>Security & account</h2>
        <p>Sign in with your email and password. Manage your password below.</p>
        <div
          className="heading-actions"
          style={{ justifyContent: "flex-start" }}
        >
          <Button variant="outline" asChild>
            <Link href="/auth/password">
              <LockKeyhole size={14} />
              Change password
            </Link>
          </Button>
        </div>
      </section>
      {admin && (
        <>
          <section className="panel settings-panel">
            <h2>White-label identity</h2>
            <p>
              Manage your platform name, support address, and operational
              defaults.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              {mutation.error && <ErrorBanner error={mutation.error} />}
              <div className="form-grid">
                {Object.entries(branding).map(([key, value]) => (
                  <label className="form-field" key={key}>
                    {key.replaceAll("_", " ")}
                    <Input
                      required
                      type={key === "support_email" ? "email" : "text"}
                      value={value}
                      onChange={(e) =>
                        setBranding((v) => ({ ...v, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="form-actions">
                <fieldset disabled={!configured}>
                  <SubmitButton pending={mutation.isPending}>
                    Save identity
                  </SubmitButton>
                </fieldset>
              </div>
            </form>
          </section>
          <section className="panel settings-panel">
            <h2>Workspace configuration</h2>
            <p>
              {configured
                ? "Supabase is configured. Review deployment and operational checks before using live customer traffic."
                : "Database credentials and the server encryption key must be configured before operational modules are enabled."}
            </p>
            <Button variant="outline" onClick={openSetup}>
              <Database size={14} />
              View setup checklist
            </Button>
          </section>
        </>
      )}
    </div>
  );
}
