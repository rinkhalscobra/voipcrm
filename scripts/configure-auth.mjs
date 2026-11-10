import { management } from "./management.mjs";
const current = await management("/config/auth");
const brand = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel";
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000").origin;
const allowed = new Set(
  (current.uri_allow_list ?? "").split(",").filter(Boolean),
);
allowed.add(`${origin}/auth/**`);
const template = (type, heading, description) =>
  `<h2>${heading}</h2><p>${description}</p><p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}">Continue securely</a></p><p>If you did not expect this email, you can ignore it.</p>`;
const customEmailConfigured = Boolean(
  current.smtp_host && current.smtp_admin_email,
);
const emailBranding = customEmailConfigured
  ? {
      smtp_sender_name: brand,
      mailer_subjects_invite: `Your ${brand} workspace invitation`,
      mailer_subjects_recovery: `Reset your ${brand} password`,
      mailer_subjects_confirmation: `Confirm your ${brand} account`,
      mailer_templates_invite_content: template(
        "invite",
        `Your ${brand} workspace invitation`,
        `You have been invited to ${brand}. Set your password to continue.`,
      ),
      mailer_templates_recovery_content: template(
        "recovery",
        `Reset your ${brand} password`,
        `Use this link to set a new ${brand} account password.`,
      ),
      mailer_templates_confirmation_content: template(
        "email",
        `Confirm your ${brand} account`,
        `Confirm your email to start using your ${brand} company workspace.`,
      ),
    }
  : {};
await management("/config/auth", {
  method: "PATCH",
  body: {
    disable_signup: false,
    mailer_autoconfirm: process.env.DATA_MODE === "demo",
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
  `Authentication configured: email/password login, new-company registration, 8-character minimum passwords, ${process.env.DATA_MODE === "demo" ? "immediate demo sign-in" : "email verification"}. ${customEmailConfigured ? `${brand} email templates applied.` : `${brand} email templates will be applied when custom SMTP is configured.`}`,
);
