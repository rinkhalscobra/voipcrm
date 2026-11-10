import { management } from "./management.mjs";
import {
  confirmationEmail,
  accountLinkEmail,
} from "./auth-email-templates.mjs";
import verification from "../src/lib/auth/email-verification-settings.json" with { type: "json" };
const current = await management("/config/auth");
const brand = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel";
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000").origin;
const allowed = new Set(
  (current.uri_allow_list ?? "").split(",").filter(Boolean),
);
allowed.add(`${origin}/auth/**`);
const smtp = {};
if (process.env.SMTP_HOST) {
  for (const key of ["SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"])
    if (!process.env[key])
      throw new Error(`${key} is required to configure SMTP`);
  const port = Number(process.env.SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_PORT must be a valid TCP port");
  if (port === 465 && process.env.SMTP_SECURE === "false")
    throw new Error("Port 465 requires implicit TLS");
  Object.assign(smtp, {
    smtp_host: process.env.SMTP_HOST,
    smtp_port: String(port),
    smtp_user: process.env.SMTP_USER,
    smtp_pass: process.env.SMTP_PASSWORD,
    smtp_admin_email: process.env.SMTP_FROM_EMAIL,
  });
}
const customEmailConfigured = Boolean(
  (smtp.smtp_host ?? current.smtp_host) &&
  (smtp.smtp_admin_email ?? current.smtp_admin_email),
);
const messagesPerHour = Number(process.env.SMTP_RATE_LIMIT_PER_HOUR ?? 100);
if (!Number.isInteger(messagesPerHour) || messagesPerHour < 1)
  throw new Error("SMTP_RATE_LIMIT_PER_HOUR must be a positive integer");
const emailBranding = customEmailConfigured
  ? {
      ...smtp,
      smtp_sender_name: process.env.SMTP_FROM_NAME ?? brand,
      smtp_max_frequency: verification.resendAfterSeconds,
      rate_limit_email_sent: messagesPerHour,
      mailer_subjects_invite: `Your workspace invitation | ${brand}`,
      mailer_subjects_recovery: `Reset your password | ${brand}`,
      mailer_subjects_confirmation: `Verify your email address | ${brand}`,
      mailer_templates_invite_content: accountLinkEmail(
        brand,
        "invite",
        `You're invited to ${brand}`,
        `You have been invited to join a ${brand} workspace. Accept your invitation to set your password and get started.`,
      ),
      mailer_templates_recovery_content: accountLinkEmail(
        brand,
        "recovery",
        "Reset your password",
        `We received a request to reset the password for your ${brand} account. Use the button below to choose a new password.`,
      ),
      mailer_templates_confirmation_content: confirmationEmail(brand),
    }
  : {};
await management("/config/auth", {
  method: "PATCH",
  body: {
    disable_signup: false,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_otp_length: verification.codeLength,
    mailer_otp_exp: verification.expiresInSeconds,
    password_min_length: 8,
    mfa_totp_enroll_enabled: false,
    mfa_totp_verify_enabled: false,
    mfa_phone_enroll_enabled: false,
    mfa_phone_verify_enabled: false,
    mfa_web_authn_enroll_enabled: false,
    mfa_web_authn_verify_enabled: false,
    site_url: origin,
    uri_allow_list: [...allowed].join(","),
    ...emailBranding,
  },
});
console.log(
  `Authentication configured: password login, signup email verification, ${verification.codeLength}-digit single-use codes, ${verification.expiresInSeconds / 60}-minute expiry. ${customEmailConfigured ? "Custom SMTP and Voixel email templates applied." : "Configure custom SMTP to deliver verification emails."}`,
);
