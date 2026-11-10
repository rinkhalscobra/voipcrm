"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { browserDatabase } from "@/lib/supabase/browser";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { ErrorBanner, SubmitButton } from "./shared";
import { api } from "@/lib/api/client";
import verification from "@/lib/auth/email-verification-settings.json";
import {
  rememberVerification,
  pendingVerification,
  clearVerification,
} from "@/lib/auth/pending-verification";
export function AuthForm({
  configured,
  mode = "login",
}: {
  configured: boolean;
  mode?: "login" | "register" | "reset" | "password" | "verify";
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
  const [code, setCode] = useState(""),
    [resending, setResending] = useState(false),
    [resendAvailableAt, setResendAvailableAt] = useState(0),
    [clock, setClock] = useState(0);
  const cooldown = Math.max(0, Math.ceil((resendAvailableAt - clock) / 1000));
  useEffect(() => {
    if (mode !== "verify") return;
    const saved = pendingVerification();
    if (saved) {
      setEmail(saved.email);
      setResendAvailableAt(saved.resendAvailableAt);
    }
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const resendCode = async () => {
    setResending(true);
    setError(null);
    setMessage("");
    try {
      const response = await api<{ resendAfterSeconds: number }>(
        "auth/resend-verification",
        {
          method: "POST",
          data: { email },
        },
      );
      const saved = rememberVerification(
        email,
        response.data.resendAfterSeconds,
      );
      setClock(Date.now());
      setResendAvailableAt(saved.resendAvailableAt);
      setCode("");
      setMessage(
        "If this address is awaiting verification, a new code is on its way. Check your inbox and spam folder.",
      );
    } catch (err) {
      setError(err as Error);
    } finally {
      setResending(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "register") {
        const response = await api<{
          requiresEmailVerification: boolean;
          resendAfterSeconds: number;
        }>("auth/register", {
          method: "POST",
          data: {
            full_name: fullName,
            company_name: companyName,
            email,
            password,
            country,
            currency,
          },
        });
        if (response.data.requiresEmailVerification) {
          rememberVerification(email, response.data.resendAfterSeconds);
          setPassword("");
          window.location.assign("/auth/verify");
        } else window.location.assign("/");
        return;
      }
      if (mode === "verify") {
        await api("auth/verify-email", {
          method: "POST",
          data: { email, code },
        });
        clearVerification();
        setCode("");
        window.location.assign("/");
        return;
      }
      const db = browserDatabase();
      if (mode === "login") {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error?.code === "email_not_confirmed") {
          rememberVerification(email);
          window.location.assign("/auth/verify");
          return;
        }
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
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/password`,
        });
        if (error)
          throw new Error(
            "The reset email could not be sent. Please try again shortly.",
          );
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
                : mode === "verify"
                  ? "Verify your email"
                  : mode === "reset"
                    ? "Reset your password"
                    : "Set your password"}
          </h1>
          <p>
            {mode === "login"
              ? "Sign in to manage your connected business."
              : mode === "register"
                ? "Register a new company workspace. Existing companies invite their employees."
                : mode === "verify"
                  ? `Enter the ${verification.codeLength}-digit code from your email, or request a new one below. Codes expire after ${verification.expiresInSeconds / 60} minutes.`
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
            {mode === "verify" && (
              <label className="form-field">
                Verification code
                <Input
                  className="verification-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  minLength={verification.codeLength}
                  maxLength={verification.codeLength}
                  pattern={`[0-9]{${verification.codeLength}}`}
                  value={code}
                  onChange={(event) => {
                    setCode(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, verification.codeLength),
                    );
                    setError(null);
                  }}
                  placeholder="000000"
                />
              </label>
            )}
            {mode !== "reset" && mode !== "verify" && (
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
                  <Select
                    id="registration-currency"
                    aria-label="Billing currency"
                    value={currency}
                    onValueChange={setCurrency}
                    options={["EUR", "USD", "GBP"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </label>
              </div>
            )}
          </div>
          <div className="form-actions">
            <fieldset style={{ width: "100%" }} disabled={!configured}>
              <SubmitButton pending={pending || resending}>
                {mode === "login"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create account"
                    : mode === "verify"
                      ? "Verify and continue"
                      : mode === "reset"
                        ? "Send reset link"
                        : "Update password"}
                <ArrowRight size={14} />
              </SubmitButton>
            </fieldset>
          </div>
          {mode === "verify" && (
            <div className="verification-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !configured ||
                  !email.trim() ||
                  pending ||
                  resending ||
                  cooldown > 0
                }
                onClick={resendCode}
              >
                {resending
                  ? "Sending code…"
                  : cooldown > 0
                    ? `Resend code in ${cooldown}s`
                    : "Resend code"}
              </Button>
              <span className="form-hint">
                Use the most recent code. Check spam if it has not arrived.
              </span>
            </div>
          )}
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <Link href="/auth/reset">Forgot password?</Link>
                <Link href="/register">Create account</Link>
                <Link href="/auth/verify">Verify email</Link>
              </>
            ) : (
              <Link href="/login">Back to sign in</Link>
            )}
            {mode === "verify" && (
              <Link href="/register">Use a different email</Link>
            )}
            {mode !== "login" && mode !== "verify" && (
              <Link href={configured ? "/" : "/admin"}>
                {configured ? "Open workspace" : "View setup workspace"}
              </Link>
            )}
          </div>
          <div className="auth-bottom" style={{ marginTop: 36 }}>
            <LockKeyhole size={12} />
            {mode === "verify"
              ? "Secure email verification by Voixel."
              : "New workspaces can register. Existing companies use invitations."}
          </div>
        </form>
      </main>
    </div>
  );
}
