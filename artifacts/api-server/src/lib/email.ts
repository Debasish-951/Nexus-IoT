import { authConfig } from "./auth-config";
import { logger } from "./logger";
import { recordSecurityEvent } from "./security-log";

/**
 * Outbound transactional email for the account lifecycle.
 *
 * Three transports, selected by AUTH_EMAIL_TRANSPORT:
 *   console  — logs the rendered link. Default, so a fresh checkout works with
 *              zero configuration. index.ts refuses to boot with this in
 *              production unless AUTH_EMAIL_ALLOW_CONSOLE=true.
 *   smtp     — nodemailer, imported dynamically. `nodemailer` is already in
 *              build.mjs's `external` list, so the bundle builds whether or not
 *              it is installed; the import is guarded so a missing package
 *              degrades to a logged error rather than a crash.
 *   webhook  — POSTs {to, subject, html, text} to your own mail relay. Use this
 *              when mail goes through SendGrid/SES/Graph rather than raw SMTP.
 *
 * Delivery is never allowed to fail the caller's request: an admin creating a
 * user gets a 201 even if the mail server is down, and the failure is recorded
 * as a security event so the Security Center shows it and the admin can resend.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// ── Templates ────────────────────────────────────────────────────────────────

/** Escape every interpolated value — user-controlled names must not inject HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND = "#8b7bff";

/**
 * Table-based layout with inline styles — the only thing that renders reliably
 * across Outlook, Gmail, and Apple Mail. No external assets: images and remote
 * CSS are blocked by default in most clients and would leak a read receipt.
 */
function layout(opts: {
  heading: string;
  intro: string;
  ctaLabel?: string;
  ctaUrl?: string;
  body?: string;
  footnote?: string;
}): string {
  const product = esc(authConfig.email.productName);
  const support = authConfig.email.supportAddress
    ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">Need help? Contact
         <a href="mailto:${esc(authConfig.email.supportAddress)}" style="color:${BRAND}">${esc(authConfig.email.supportAddress)}</a>.</p>`
    : "";

  const cta = opts.ctaUrl && opts.ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0">
         <tr><td style="border-radius:8px;background:${BRAND}">
           <a href="${esc(opts.ctaUrl)}" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0d0820;text-decoration:none">${esc(opts.ctaLabel)}</a>
         </td></tr>
       </table>
       <p style="margin:0;font-size:12px;color:#64748b">If the button does not work, paste this into your browser:</p>
       <p style="margin:6px 0 0;font-size:12px;word-break:break-all"><a href="${esc(opts.ctaUrl)}" style="color:${BRAND}">${esc(opts.ctaUrl)}</a></p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
      <tr><td style="background:#0a1024;padding:22px 32px">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#ffffff">${product}</span>
      </td></tr>
      <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
        <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3">${esc(opts.heading)}</h1>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#334155">${esc(opts.intro)}</p>
        ${cta}
        ${opts.body ?? ""}
        ${opts.footnote ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#64748b">${esc(opts.footnote)}</p>` : ""}
        ${support}
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8">
        This is an automated message — please do not reply. You are receiving it because an administrator
        manages your ${product} account.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function policyListHtml(policy: string[]): string {
  return `<p style="margin:22px 0 6px;font-size:13px;font-weight:bold;color:#0f172a">Your password must have:</p>
    <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.7;color:#334155">
      ${policy.map((p) => `<li>${esc(p)}</li>`).join("")}
    </ul>`;
}

function hoursOrMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}

export function renderActivationEmail(opts: {
  fullName: string;
  url: string;
  expiresAt: Date;
  invitedBy?: string | null;
  role: string;
  policy: string[];
}): OutboundEmail {
  const product = authConfig.email.productName;
  const validFor = hoursOrMinutes(authConfig.tokens.activationTtlMs);
  const invitedBy = opts.invitedBy ? ` by ${opts.invitedBy}` : "";
  const intro =
    `An account has been created for you on ${product}${invitedBy} with the role "${opts.role}". ` +
    `To finish setting it up, choose a password using the link below.`;

  return {
    to: "",
    subject: `Activate your ${product} account`,
    html: layout({
      heading: `Welcome, ${opts.fullName}`,
      intro,
      ctaLabel: "Activate my account",
      ctaUrl: opts.url,
      body: policyListHtml(opts.policy),
      footnote:
        `This link can be used once and expires in ${validFor} ` +
        `(${opts.expiresAt.toUTCString()}). If it has expired, ask your administrator to resend the invitation. ` +
        `If you were not expecting this email, you can ignore it — no account is usable until it is activated.`,
    }),
    text:
      `Welcome, ${opts.fullName}\n\n${intro}\n\n${opts.url}\n\n` +
      `Password requirements:\n${opts.policy.map((p) => `  - ${p}`).join("\n")}\n\n` +
      `This link can be used once and expires in ${validFor} (${opts.expiresAt.toUTCString()}).\n` +
      `If you were not expecting this email, you can ignore it.\n`,
  };
}

export function renderPasswordResetEmail(opts: {
  fullName: string;
  url: string;
  expiresAt: Date;
  policy: string[];
  initiatedByAdmin: boolean;
}): OutboundEmail {
  const product = authConfig.email.productName;
  const validFor = hoursOrMinutes(authConfig.tokens.passwordResetTtlMs);
  const intro = opts.initiatedByAdmin
    ? `An administrator has started a password reset for your ${product} account. Choose a new password using the link below.`
    : `We received a request to reset the password for your ${product} account. Choose a new password using the link below.`;

  return {
    to: "",
    subject: `Reset your ${product} password`,
    html: layout({
      heading: "Reset your password",
      intro,
      ctaLabel: "Choose a new password",
      ctaUrl: opts.url,
      body: policyListHtml(opts.policy),
      footnote:
        `This link can be used once and expires in ${validFor} (${opts.expiresAt.toUTCString()}). ` +
        `Resetting your password signs you out of every other device. ` +
        `If you did not request this, no action is needed — your current password still works — but please tell your administrator.`,
    }),
    text:
      `Reset your password\n\n${intro}\n\n${opts.url}\n\n` +
      `Password requirements:\n${opts.policy.map((p) => `  - ${p}`).join("\n")}\n\n` +
      `Expires in ${validFor} (${opts.expiresAt.toUTCString()}). Single use.\n` +
      `If you did not request this, no action is needed, but please tell your administrator.\n`,
  };
}

export function renderPasswordChangedEmail(opts: { fullName: string; when: Date; ip: string | null }): OutboundEmail {
  const product = authConfig.email.productName;
  const where = opts.ip ? ` from ${opts.ip}` : "";
  const intro =
    `The password for your ${product} account was changed on ${opts.when.toUTCString()}${where}. ` +
    `All other sessions have been signed out.`;
  return {
    to: "",
    subject: `Your ${product} password was changed`,
    html: layout({
      heading: "Your password was changed",
      intro,
      footnote: "If this was not you, contact your administrator immediately — your account may be compromised.",
    }),
    text: `Your password was changed\n\n${intro}\n\nIf this was not you, contact your administrator immediately.\n`,
  };
}

export function renderAccountLockedEmail(opts: { fullName: string; until: Date; ip: string | null }): OutboundEmail {
  const product = authConfig.email.productName;
  const where = opts.ip ? ` from ${opts.ip}` : "";
  const intro =
    `Your ${product} account has been temporarily locked after repeated failed sign-in attempts${where}. ` +
    `It will unlock automatically at ${opts.until.toUTCString()}.`;
  return {
    to: "",
    subject: `Your ${product} account is temporarily locked`,
    html: layout({
      heading: "Account temporarily locked",
      intro,
      footnote:
        "If this was you, simply wait and try again, or use \"Forgot password?\" to reset. " +
        "If it was not you, someone is attempting to guess your password — tell your administrator.",
    }),
    text: `Account temporarily locked\n\n${intro}\n\nIf this was not you, tell your administrator.\n`,
  };
}

// ── Transports ───────────────────────────────────────────────────────────────

type Transport = (mail: OutboundEmail) => Promise<void>;

const consoleTransport: Transport = async (mail) => {
  // Pull the first link out so the activation URL is trivially copyable from
  // the dev console without scrolling through rendered HTML.
  const link = mail.text.match(/https?:\/\/\S+/)?.[0];
  logger.warn(
    { to: mail.to, subject: mail.subject, link },
    `📧  [console transport] ${mail.subject} → ${mail.to}${link ? `\n    ${link}` : ""}`,
  );
};

let smtpTransporter: { sendMail: (o: Record<string, unknown>) => Promise<unknown> } | null = null;
let smtpInitFailed = false;

const smtpTransport: Transport = async (mail) => {
  if (smtpInitFailed) throw new Error("SMTP transport unavailable (nodemailer not installed)");

  if (!smtpTransporter) {
    let nodemailer: { createTransport: (o: Record<string, unknown>) => typeof smtpTransporter };
    try {
      // Dynamic + externalised so the bundle builds without the dependency, and
      // the specifier is held in a variable so `tsc` does not demand the types
      // of a package that is optional by design.
      // Install with: pnpm --filter @workspace/api-server add nodemailer
      const specifier = "nodemailer";
      nodemailer = (await import(specifier)) as never;
    } catch (err) {
      smtpInitFailed = true;
      logger.error({ err },
        "AUTH_EMAIL_TRANSPORT=smtp but `nodemailer` is not installed. " +
        "Run: pnpm --filter @workspace/api-server add nodemailer");
      throw new Error("SMTP transport unavailable (nodemailer not installed)");
    }

    const { host, port, secure, user, pass } = authConfig.email.smtp;
    smtpTransporter = nodemailer.createTransport({
      host, port, secure,
      ...(user ? { auth: { user, pass } } : {}),
      // Never silently fall back to an unverified certificate.
      tls: { rejectUnauthorized: true },
    });
  }

  await smtpTransporter!.sendMail({
    from: authConfig.email.from,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
};

const webhookTransport: Transport = async (mail) => {
  const res = await fetch(authConfig.email.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authConfig.email.webhookAuthHeader ? { authorization: authConfig.email.webhookAuthHeader } : {}),
    },
    body: JSON.stringify({
      from: authConfig.email.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`email webhook returned ${res.status} ${res.statusText}`);
  }
};

function selectTransport(): Transport {
  switch (authConfig.email.transport) {
    case "smtp": return smtpTransport;
    case "webhook": return webhookTransport;
    default: return consoleTransport;
  }
}

/**
 * Send an email. Resolves to true on success, false on failure — it never
 * rejects, so callers can decide whether the outcome matters without a
 * try/catch around every call site.
 */
export async function sendEmail(
  to: string,
  mail: OutboundEmail,
  context: { userId?: string | null; username?: string | null; purpose: string },
): Promise<boolean> {
  const payload = { ...mail, to };
  try {
    await selectTransport()(payload);
    logger.info({ to, purpose: context.purpose }, "email sent");
    return true;
  } catch (err) {
    logger.error({ err, to, purpose: context.purpose }, "email delivery failed");
    recordSecurityEvent({
      type: "email.failed",
      outcome: "failure",
      userId: context.userId ?? null,
      username: context.username ?? null,
      reason: context.purpose,
      detail: { transport: authConfig.email.transport, error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}
