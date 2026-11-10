"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { browserDatabase } from "@/lib/supabase/browser";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ErrorBanner, SubmitButton } from "./shared";
import { api } from "@/lib/api/client";
export function AuthForm({
  configured,
  mode = "login",
}: {
  configured: boolean;
  mode?: "login" | "register" | "reset" | "password";
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [message, setMessage] = useState("");
  const [fullName, setFullName] = useState(""),
    [companyName, setCompanyName] = useState(""),
    [country, setCountry] = useState("Germany"),
    [currency, setCurrency] = useState("EUR");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "register") {
        const response = await api<{ requiresEmailVerification: boolean }>(
          "auth/register",
          {
            method: "POST",
            data: {
              full_name: fullName,
              company_name: companyName,
              email,
              password,
              country,
              currency,
            },
          },
        );
        if (response.data.requiresEmailVerification)
          setMessage(
            "Your workspace has been created. Check your email to confirm your account, then sign in.",
          );
        else window.location.assign("/");
        return;
      }
      const db = browserDatabase();
      if (mode === "login") {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error)
          throw new Error(
            "Unable to sign in. Check your credentials and email verification.",
          );
        await fetch("/api/auth/login-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        window.location.assign("/");
      } else if (mode === "reset") {
        await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/password`,
        });
        setMessage(
          "If an account exists, a password reset link has been sent.",
        );
      } else {
        const { error } = await db.auth.updateUser({ password });
        if (error)
          throw new Error(
            "The password could not be changed. Sign in or request a new recovery link.",
          );
        setMessage("Password updated. You can continue to your workspace.");
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <Brand size={176} />
        <div className="auth-copy">
          <span className="eyebrow">YOUR NETWORK. YOUR BUSINESS.</span>
          <h1>
            Every connection.
            <br />
            One clear view.
          </h1>
          <p>
            The workspace for your telecom operations. Connect your providers,
            empower your customers, and keep every detail in control.
          </p>
          <div className="auth-line-art" aria-hidden="true">
            {[
              18, 35, 25, 58, 40, 72, 50, 31, 63, 44, 76, 54, 32, 47, 27, 16,
            ].map((h, i) => (
              <i key={i} style={{ height: h, opacity: 0.3 + i * 0.035 }} />
            ))}
          </div>
        </div>
        <div className="auth-bottom">
          <ShieldCheck size={14} />
          Encrypted credentials. Isolated workspaces. Auditable actions.
        </div>
      </div>
      <main className="auth-form-panel">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-mobile-brand">
            <Brand size={160} />
          </div>
          <span className="eyebrow">SECURE WORKSPACE ACCESS</span>
          <h1>
            {mode === "login"
              ? "Welcome back"
              : mode === "register"
                ? "Create your workspace"
                : mode === "reset"
                  ? "Reset your password"
                  : "Set your password"}
          </h1>
          <p>
            {mode === "login"
              ? "Sign in to manage your connected business."
              : mode === "register"
                ? "Register a new company workspace. Existing companies invite their employees."
                : mode === "reset"
                  ? "Enter your account email to request a reset link."
                  : "Choose a password with at least 8 characters."}
          </p>
          {!configured && (
            <div className="notice">
              Configure Supabase to enable authentication. The admin setup
              interface is available below.
            </div>
          )}
          {error && <ErrorBanner error={error} />}
          {message && (
            <div className="notice" role="status">
              {message}
            </div>
          )}
          <div className="form-grid">
            {mode === "register" && (
              <>
                <label className="form-field">
                  Full name
                  <Input
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={100}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                  />
                </label>
                <label className="form-field">
                  Company name
                  <Input
                    autoComplete="organization"
                    required
                    minLength={2}
                    maxLength={160}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Your company"
                  />
                </label>
              </>
            )}
            {mode !== "password" && (
              <label className="form-field">
                Email address
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label className="form-field">
                Password
                <Input
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={
                    mode === "password" || mode === "register" ? 8 : undefined
                  }
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
              </label>
            )}
            {mode === "register" && (
              <div className="signup-row">
                <label className="form-field">
                  Country
                  <Input
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="country-name"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </label>
                <label className="form-field" htmlFor="registration-currency">
                  Billing currency
                  <select
                    id="registration-currency"
                    className="form-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>
              </div>
            )}
          </div>
          <div className="form-actions">
            <fieldset style={{ width: "100%" }} disabled={!configured}>
              <SubmitButton pending={pending}>
                {mode === "login"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create account"
                    : mode === "reset"
                      ? "Send reset link"
                      : "Update password"}
                <ArrowRight size={14} />
              </SubmitButton>
            </fieldset>
          </div>
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <Link href="/auth/reset">Forgot password?</Link>
                <Link href="/register">Create account</Link>
              </>
            ) : (
              <Link href="/login">Back to sign in</Link>
            )}
            {mode !== "login" && (
              <Link href={configured ? "/" : "/admin"}>
                {configured ? "Open workspace" : "View setup workspace"}
              </Link>
            )}
          </div>
          <div className="auth-bottom" style={{ marginTop: 36 }}>
            <LockKeyhole size={12} />
            New workspaces can register. Existing companies use invitations.
          </div>
        </form>
      </main>
    </div>
  );
}
