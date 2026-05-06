type TemplateInput = {
  logoUrl: string;
  title: string;
  preheader: string;
  greeting: string;
  intro: string;
  body: string[];
  code?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
  helpText?: string;
};

type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderShell(input: TemplateInput) {
  const bodyHtml = input.body
    .map(
      (line) =>
        `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(line)}</p>`,
    )
    .join('');

  const codeHtml = input.code
    ? `
      <div style="margin:22px 0;padding:18px 20px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Verification code</div>
        <div style="font-size:34px;line-height:1;font-weight:800;letter-spacing:.18em;color:#0f172a;">${escapeHtml(input.code)}</div>
      </div>
    `
    : '';

  const ctaHtml =
    input.ctaLabel && input.ctaUrl
      ? `
        <div style="margin:26px 0 18px;">
          <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;">
            ${escapeHtml(input.ctaLabel)}
          </a>
        </div>
      `
      : '';

  const helpTextHtml = input.helpText
    ? `<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(input.helpText)}</p>`
    : '';

  const footer =
    input.footer ??
    'TchokoPay sends security and account emails to help keep your account safe.';

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(input.title)}</title>
      </head>
      <body style="margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:28px 28px 12px;background:#0f172a;">
                    <img src="${escapeHtml(input.logoUrl)}" alt="TchokoPay" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:14px;" />
                    <div style="margin-top:16px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;">TchokoPay</div>
                    <h1 style="margin:10px 0 0;color:#ffffff;font-size:28px;line-height:1.2;">${escapeHtml(input.title)}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="margin:0 0 14px;color:#0f172a;font-size:16px;line-height:1.7;">${escapeHtml(input.greeting)}</p>
                    <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(input.intro)}</p>
                    ${codeHtml}
                    ${bodyHtml}
                    ${ctaHtml}
                    ${helpTextHtml}
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 28px 28px;border-top:1px solid #e2e8f0;">
                    <p style="margin:0;color:#64748b;font-size:12px;line-height:1.7;">${escapeHtml(footer)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const text = [
    `TchokoPay - ${input.title}`,
    '',
    input.greeting,
    '',
    input.intro,
    '',
    ...(input.code ? [`Verification code: ${input.code}`, ''] : []),
    ...input.body.flatMap((line) => [line, '']),
    ...(input.ctaLabel && input.ctaUrl
      ? [`${input.ctaLabel}: ${input.ctaUrl}`, '']
      : []),
    ...(input.helpText ? [input.helpText, ''] : []),
    footer,
  ].join('\n');

  return { html, text };
}

export function renderOtpEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  code: string;
  purpose: string;
  expiresInMinutes: number;
  actionUrl?: string;
}): EmailTemplate {
  const subject = `${input.purpose} code`;
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: input.purpose,
    preheader: `Your TchokoPay verification code is ${input.code}.`,
    greeting,
    intro: `Use the code below to continue with ${input.purpose.toLowerCase()}.`,
    code: input.code,
    body: [
      `This code expires in ${input.expiresInMinutes} minutes.`,
      'If you did not request this, you can safely ignore this email.',
    ],
    ctaLabel: input.actionUrl ? 'Open TchokoPay' : undefined,
    ctaUrl: input.actionUrl,
    helpText:
      'For your security, never share this code with anyone, including support.',
  });

  return { subject, ...content };
}

export function renderWelcomeEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = 'Welcome to TchokoPay';
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: 'Your account is ready',
    preheader: 'Welcome to TchokoPay.',
    greeting,
    intro:
      'Your account is now active. You can start sending, receiving, and managing payouts from your dashboard.',
    body: [
      'Keep your contact details and payout settings up to date so your payments always route correctly.',
    ],
    ctaLabel: 'Open dashboard',
    ctaUrl: input.dashboardUrl,
  });

  return { subject, ...content };
}

export function renderGoogleLinkedEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = 'Google sign-in linked to your account';
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: 'Google sign-in linked',
    preheader: 'A Google sign-in method was linked to your TchokoPay account.',
    greeting,
    intro:
      'A Google account was linked to your TchokoPay sign-in. You can now use Google to access the same account.',
    body: [
      'If this was you, no further action is needed.',
      'If this was not you, change your password and review your account activity immediately.',
    ],
    ctaLabel: 'Review account',
    ctaUrl: input.dashboardUrl,
  });

  return { subject, ...content };
}

export function renderPasswordChangedEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = 'Your password was changed';
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: 'Password changed',
    preheader: 'Your TchokoPay password has been updated.',
    greeting,
    intro:
      'Your TchokoPay password was changed successfully.',
    body: [
      'If you made this change, you are all set.',
      'If you did not make this change, secure your account immediately.',
    ],
    ctaLabel: 'Open security settings',
    ctaUrl: `${input.dashboardUrl}/account`,
  });

  return { subject, ...content };
}

export function renderContactVerifiedEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  contactLabel: string;
  value: string;
  changed?: boolean;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = input.changed
    ? `${input.contactLabel} updated`
    : `${input.contactLabel} verified`;
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: input.changed
      ? `${input.contactLabel} updated`
      : `${input.contactLabel} verified`,
    preheader: `${input.contactLabel} confirmed on your TchokoPay account.`,
    greeting,
    intro: input.changed
      ? `Your ${input.contactLabel.toLowerCase()} is now ${input.value}.`
      : `Your ${input.contactLabel.toLowerCase()} has been verified successfully.`,
    body: [
      'You can manage your account details anytime from your settings page.',
    ],
    ctaLabel: 'Open account settings',
    ctaUrl: `${input.dashboardUrl}/account`,
  });

  return { subject, ...content };
}

export function renderEmailAddressChangedAlert(input: {
  logoUrl: string;
  firstName?: string | null;
  newEmail: string;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = 'Your sign-in email was changed';
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: 'Email address changed',
    preheader: 'Your account email was updated.',
    greeting,
    intro: `The email address on your TchokoPay account was changed to ${input.newEmail}.`,
    body: [
      'If you made this change, no further action is needed.',
      'If you did not make this change, review your account immediately.',
    ],
    ctaLabel: 'Review account',
    ctaUrl: `${input.dashboardUrl}/account`,
  });

  return { subject, ...content };
}

export function renderPayoutRouteVerifiedEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  phone: string;
  providerName: string;
  countryName: string;
  isPrimary: boolean;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = input.isPrimary
    ? 'Primary payout route verified'
    : 'Payout route verified';
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: 'Payout route verified',
    preheader: 'A payout number on your TchokoPay account was verified.',
    greeting,
    intro: `${input.providerName} (${input.phone}) in ${input.countryName} is now ready to receive payouts.`,
    body: input.isPrimary
      ? ['This number is currently set as your primary payout route.']
      : ['You can make this number primary any time from payout settings.'],
    ctaLabel: 'Open payout settings',
    ctaUrl: `${input.dashboardUrl}/account`,
  });

  return { subject, ...content };
}

export function renderPrimaryPayoutChangedEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  phone: string;
  providerName: string;
  countryName: string;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = 'Primary payout route updated';
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const content = renderShell({
    logoUrl: input.logoUrl,
    title: 'Primary payout route updated',
    preheader: 'Your default payout number was changed.',
    greeting,
    intro: `${input.providerName} (${input.phone}) in ${input.countryName} is now your primary payout route.`,
    body: [
      'New QR and handle payments will be routed to this payout destination.',
    ],
    ctaLabel: 'Review payout settings',
    ctaUrl: `${input.dashboardUrl}/account`,
  });

  return { subject, ...content };
}
