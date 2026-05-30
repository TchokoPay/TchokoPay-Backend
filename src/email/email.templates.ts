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

function formatAmountNumber(amount: number) {
  if (!Number.isFinite(amount)) return '0';

  return new Intl.NumberFormat('en', {
    maximumFractionDigits: 8,
  }).format(amount);
}

function titleCase(value: string) {
  return (value || 'TchokoPay')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderTransactionShell(input: {
  logoUrl: string;
  title: string;
  preheader: string;
  statusLabel: string;
  statusTone: 'success' | 'danger';
  amount: number;
  currency: string;
  headline: string;
  message: string;
  supportMessage: string;
  reference: string;
  ctaLabel: string;
  ctaUrl: string;
  footer?: string;
}) {
  const amount = formatAmountNumber(input.amount);
  const currency = input.currency?.trim().toUpperCase() || 'XAF';
  const fontFamily = "'Sora', Inter, Arial, sans-serif";
  const tone =
    input.statusTone === 'success'
      ? {
          bg: '#ecfdf5',
          border: '#bbf7d0',
          text: '#047857',
        }
      : {
          bg: '#fff1f2',
          border: '#fecdd3',
          text: '#be123c',
        };
  const footer =
    input.footer ??
    'TchokoPay sends transaction emails so you can track payments and payouts with confidence.';

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(input.title)}</title>
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body style="margin:0;background:#f8fafc;font-family:${fontFamily};">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;font-family:${fontFamily};">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0;font-family:${fontFamily};">
                <tr>
                  <td align="center" style="padding:30px 24px 18px;background:#0f172a;">
                    <img src="${escapeHtml(input.logoUrl)}" alt="TchokoPay" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:14px;margin:0 auto;" />
                    <div style="margin-top:14px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;">TchokoPay</div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:34px 28px 32px;">
                    <span style="display:inline-block;border-radius:999px;background:${tone.bg};border:1px solid ${tone.border};color:${tone.text};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:8px 12px;">${escapeHtml(input.statusLabel)}</span>

                    <div style="margin:24px auto 0;max-width:460px;text-align:center;">
                      <div style="color:#0f172a;font-size:66px;line-height:1;font-weight:800;letter-spacing:0;text-align:center;word-break:break-word;">${escapeHtml(amount)}</div>
                      <div style="margin-top:8px;color:#64748b;font-size:18px;line-height:1.2;font-weight:800;letter-spacing:.14em;text-transform:uppercase;text-align:center;">${escapeHtml(currency)}</div>
                    </div>
                    <h1 style="margin:18px 0 0;color:#0f172a;font-size:24px;line-height:1.3;font-weight:700;text-align:center;">${escapeHtml(input.headline)}</h1>

                    <p style="margin:22px auto 0;max-width:430px;color:#475569;font-size:15px;line-height:1.75;text-align:center;">${escapeHtml(input.message)}</p>

                    <p style="margin:12px auto 0;max-width:430px;color:#64748b;font-size:13px;line-height:1.7;text-align:center;">${escapeHtml(input.supportMessage)}</p>

                    <div style="margin:24px auto 0;max-width:360px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;padding:14px 16px;">
                      <div style="color:#64748b;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Transaction ID</div>
                      <div style="margin-top:6px;color:#0f172a;font-size:14px;font-weight:700;letter-spacing:0;word-break:break-word;">${escapeHtml(input.reference)}</div>
                    </div>

                    <div style="margin:28px 0 0;">
                      <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:700;">${escapeHtml(input.ctaLabel)}</a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 28px 28px;border-top:1px solid #e2e8f0;">
                    <p style="margin:0;color:#64748b;font-size:12px;line-height:1.7;text-align:center;">${escapeHtml(footer)}</p>
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
    `${amount} ${currency}`,
    input.headline,
    '',
    input.message,
    input.supportMessage,
    '',
    `Transaction ID: ${input.reference}`,
    '',
    `${input.ctaLabel}: ${input.ctaUrl}`,
    '',
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

export function renderTransactionSuccessfulEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  reference: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  payoutMethod: string;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = `${formatAmountNumber(input.amount)} ${input.currency?.trim().toUpperCase() || 'XAF'} sent successfully`;
  const message = input.firstName
    ? `${input.firstName}, your payment has been completed successfully.`
    : 'Your payment has been completed successfully.';
  const content = renderTransactionShell({
    logoUrl: input.logoUrl,
    title: 'Payment successful',
    preheader: `Payment successful. Transaction ID: ${input.reference}.`,
    statusLabel: 'Payment successful',
    statusTone: 'success',
    amount: input.amount,
    currency: input.currency,
    headline: 'sent successfully',
    message,
    supportMessage: `The payment was funded through ${titleCase(input.paymentMethod)} and delivered through ${titleCase(input.payoutMethod)}.`,
    reference: input.reference,
    ctaLabel: 'View transaction',
    ctaUrl: `${input.dashboardUrl}/transactions`,
    footer:
      'TchokoPay sends transaction emails so you can track payments and payouts with confidence.',
  });

  return { subject, ...content };
}

export function renderTransactionFailedEmail(input: {
  logoUrl: string;
  firstName?: string | null;
  reference: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  payoutMethod: string;
  failureReason?: string | null;
  dashboardUrl: string;
}): EmailTemplate {
  const subject = 'We could not complete your TchokoPay transaction';
  const message = input.firstName
    ? `${input.firstName}, we could not complete this payment.`
    : 'We could not complete this payment.';
  const supportMessage = input.failureReason
    ? `Please open your dashboard to request a refund review. Reason from the payment rail: ${input.failureReason}`
    : 'Please open your dashboard to request a refund review using this transaction ID.';
  const content = renderTransactionShell({
    logoUrl: input.logoUrl,
    title: 'Payment needs attention',
    preheader: `Payment failed. Transaction ID: ${input.reference}.`,
    statusLabel: 'Payment failed',
    statusTone: 'danger',
    amount: input.amount,
    currency: input.currency,
    headline: 'not completed',
    message,
    supportMessage,
    reference: input.reference,
    ctaLabel: 'Open dashboard',
    ctaUrl: `${input.dashboardUrl}/transactions`,
    footer:
      'TchokoPay sends transaction emails so you can track payments and payouts with confidence.',
  });

  return { subject, ...content };
}
