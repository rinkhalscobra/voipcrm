import settings from "../src/lib/auth/email-verification-settings.json" with { type: "json" };

const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

function emailLayout(brand, { preheader, category, heading, content }) {
  const name = escapeHtml(brand);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(heading)} | ${name}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-outer { padding: 24px 12px !important; }
      .email-content { padding: 28px 24px !important; }
      .email-heading { font-size: 24px !important; line-height: 32px !important; }
      .email-code { font-size: 30px !important; letter-spacing: 5px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f5f8;color:#171923;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8">
    <tr><td class="email-outer" align="center" style="padding:48px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border:1px solid #e2e5ec;border-radius:14px;overflow:hidden">
        <tr><td style="height:4px;background:#7140b6;border-radius:14px 14px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td class="email-content" style="padding:36px 40px">
          <p style="margin:0 0 36px;font-size:26px;font-weight:700;line-height:32px;letter-spacing:-0.8px;color:#171923">${name}<span style="color:#7140b6">.</span></p>
          <p style="margin:0 0 12px;color:#646b79;font-size:11px;font-weight:600;line-height:16px;letter-spacing:1.4px;text-transform:uppercase">${escapeHtml(category)}</p>
          <h1 class="email-heading" style="margin:0 0 16px;color:#171923;font-size:27px;font-weight:600;line-height:35px;letter-spacing:-0.6px">${escapeHtml(heading)}</h1>
          ${content}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #e8eaf0">
            <tr><td style="padding-top:22px;color:#697180;font-size:12px;line-height:20px">${name} &middot; Account security<br>Please do not reply to this automated message.</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function confirmationEmail(brand) {
  const name = escapeHtml(brand);
  const minutes = settings.expiresInSeconds / 60;
  return emailLayout(brand, {
    preheader: `Complete your ${brand} registration with the code inside. Valid for ${minutes} minutes.`,
    category: "Email verification",
    heading: "Confirm your email address",
    content: `<p style="margin:0 0 24px;color:#495160;font-size:15px;line-height:25px">Enter the code below to verify your email address and finish setting up your ${name} account.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7fc;border:1px solid #e8e2f3;border-radius:10px">
            <tr><td align="center" style="padding:22px 12px 24px">
              <p style="margin:0 0 12px;color:#626878;font-size:12px;line-height:18px">Your verification code</p>
              <p class="email-code" style="margin:0;color:#171923;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;line-height:42px;letter-spacing:7px">{{ .Token }}</p>
            </td></tr>
          </table>
          <p style="margin:18px 0 0;color:#495160;font-size:13px;line-height:22px">Expires in <strong style="color:#2f3542;font-weight:600">${minutes} minutes</strong>. This code can be used once.</p>
          <p style="margin:26px 0 0;color:#697180;font-size:13px;line-height:22px">If you didn&rsquo;t create a ${name} account, you can safely ignore this email.</p>`,
  });
}

export function accountLinkEmail(brand, type, heading, description) {
  const invitation = type === "invite";
  const action = invitation ? "Accept invitation" : "Reset password";
  return emailLayout(brand, {
    preheader: invitation
      ? `Your invitation to join a ${brand} workspace.`
      : `Set a new password for your ${brand} account.`,
    category: invitation ? "Workspace invitation" : "Account security",
    heading,
    content: `<p style="margin:0 0 28px;color:#495160;font-size:15px;line-height:25px">${escapeHtml(description)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#7140b6;border-radius:8px"><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}" style="display:inline-block;padding:14px 24px;border:1px solid #7140b6;border-radius:8px;color:#ffffff;font-size:14px;font-weight:600;line-height:20px;text-decoration:none">${action}</a></td></tr></table>
          <p style="margin:20px 0 0;color:#495160;font-size:13px;line-height:22px">This link expires in ${settings.expiresInSeconds / 60} minutes.</p>
          <p style="margin:26px 0 0;color:#697180;font-size:13px;line-height:22px">${invitation ? "If you weren&rsquo;t expecting this invitation, you can ignore this email." : "If you didn&rsquo;t request a password reset, you can safely ignore this email."}</p>`,
  });
}
