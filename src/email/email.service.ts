import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  renderContactVerifiedEmail,
  renderEmailAddressChangedAlert,
  renderGoogleLinkedEmail,
  renderOtpEmail,
  renderPasswordChangedEmail,
  renderPayoutRouteVerifiedEmail,
  renderPrimaryPayoutChangedEmail,
  renderTransactionFailedEmail,
  renderTransactionSuccessfulEmail,
  renderWelcomeEmail,
} from './email.templates.js';

type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: { name: string; value: string }[];
  attachments?: { filename: string; path: string }[];
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async sendOtpEmail(input: {
    to: string;
    code: string;
    firstName?: string | null;
    purpose: string;
    actionUrl?: string;
  }) {
    const template = renderOtpEmail({
      logoUrl: this.getLogoUrl(),
      firstName: input.firstName,
      code: input.code,
      purpose: input.purpose,
      expiresInMinutes: 10,
      actionUrl: input.actionUrl ?? `${this.getAppUrl()}/auth`,
    });

    return this.sendEmail({
      to: input.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'otp' }],
    });
  }

  async sendWelcomeEmail(input: {
    to: string;
    firstName?: string | null;
  }) {
    const template = renderWelcomeEmail({
      logoUrl: this.getLogoUrl(),
      firstName: input.firstName,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    return this.sendEmail({
      to: input.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'welcome' }],
    });
  }

  async sendGoogleLinkedEmail(input: {
    to: string;
    firstName?: string | null;
  }) {
    const template = renderGoogleLinkedEmail({
      logoUrl: this.getLogoUrl(),
      firstName: input.firstName,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    return this.sendEmail({
      to: input.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'security' }],
    });
  }

  async sendPasswordChangedNotice(userId: string) {
    const recipient = await this.getPrimaryEmailRecipient(userId);
    if (!recipient) return false;

    const template = renderPasswordChangedEmail({
      logoUrl: this.getLogoUrl(),
      firstName: recipient.firstName,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    await this.sendEmail({
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'security' }],
    });

    return true;
  }

  async sendContactVerifiedEmail(input: {
    to: string;
    firstName?: string | null;
    contactLabel: string;
    value: string;
    changed?: boolean;
  }) {
    const template = renderContactVerifiedEmail({
      logoUrl: this.getLogoUrl(),
      firstName: input.firstName,
      contactLabel: input.contactLabel,
      value: input.value,
      changed: input.changed,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    return this.sendEmail({
      to: input.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'account' }],
    });
  }

  async sendEmailAddressChangedAlert(input: {
    to: string;
    firstName?: string | null;
    newEmail: string;
  }) {
    const template = renderEmailAddressChangedAlert({
      logoUrl: this.getLogoUrl(),
      firstName: input.firstName,
      newEmail: input.newEmail,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    return this.sendEmail({
      to: input.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'security' }],
    });
  }

  async sendPayoutRouteVerifiedNotice(input: {
    userId: string;
    phone: string;
    providerName: string;
    countryName: string;
    isPrimary: boolean;
  }) {
    const recipient = await this.getPrimaryEmailRecipient(input.userId);
    if (!recipient) return false;

    const template = renderPayoutRouteVerifiedEmail({
      logoUrl: this.getLogoUrl(),
      firstName: recipient.firstName,
      phone: input.phone,
      providerName: input.providerName,
      countryName: input.countryName,
      isPrimary: input.isPrimary,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    await this.sendEmail({
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'payouts' }],
    });

    return true;
  }

  async sendPrimaryPayoutChangedNotice(input: {
    userId: string;
    phone: string;
    providerName: string;
    countryName: string;
  }) {
    const recipient = await this.getPrimaryEmailRecipient(input.userId);
    if (!recipient) return false;

    const template = renderPrimaryPayoutChangedEmail({
      logoUrl: this.getLogoUrl(),
      firstName: recipient.firstName,
      phone: input.phone,
      providerName: input.providerName,
      countryName: input.countryName,
      dashboardUrl: `${this.getAppUrl()}/dashboard`,
    });

    await this.sendEmail({
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [{ name: 'category', value: 'payouts' }],
    });

    return true;
  }

  async sendTransactionStatusNotice(input: {
    userId: string;
    status: 'SUCCESS' | 'FAILED';
    reference: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    payoutMethod: string;
    failureReason?: string | null;
  }) {
    const recipient = await this.getPrimaryEmailRecipient(input.userId);
    if (!recipient) return false;

    const dashboardUrl = `${this.getAppUrl()}/dashboard`;
    const template =
      input.status === 'SUCCESS'
        ? renderTransactionSuccessfulEmail({
            logoUrl: this.getLogoUrl(),
            firstName: recipient.firstName,
            reference: input.reference,
            amount: input.amount,
            currency: input.currency,
            paymentMethod: input.paymentMethod,
            payoutMethod: input.payoutMethod,
            dashboardUrl,
          })
        : renderTransactionFailedEmail({
            logoUrl: this.getLogoUrl(),
            firstName: recipient.firstName,
            reference: input.reference,
            amount: input.amount,
            currency: input.currency,
            paymentMethod: input.paymentMethod,
            payoutMethod: input.payoutMethod,
            failureReason: input.failureReason,
            dashboardUrl,
          });

    await this.sendEmail({
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [
        { name: 'category', value: 'transactions' },
        { name: 'status', value: input.status.toLowerCase() },
        { name: 'reference', value: input.reference.slice(0, 190) },
      ],
    });

    return true;
  }

  async sendWithdrawalStatusNotice(input: {
    userId: string;
    status: 'PAID' | 'REJECTED';
    reference: string;
    amount: number;
    currency: string;
    payoutMethod: string;
    reason?: string | null;
  }) {
    const recipient = await this.getPrimaryEmailRecipient(input.userId);
    if (!recipient) return false;

    const paid = input.status === 'PAID';
    const amountText = `${input.currency} ${new Intl.NumberFormat('en-US').format(input.amount)}`;
    const dashboardUrl = `${this.getAppUrl()}/merchant/payouts`;
    const title = paid ? 'Withdrawal sent ✅' : 'Withdrawal not approved';
    const intro = paid
      ? `Your withdrawal of ${amountText} has been approved and sent to your ${input.payoutMethod} account.`
      : `Your withdrawal of ${amountText} was not approved${input.reason ? `: ${input.reason}` : '.'} The amount has been returned to your TchokoPay balance.`;

    const html = `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0b1640">
    <img src="${this.getLogoUrl()}" alt="TchokoPay" width="40" height="40" style="border-radius:10px"/>
    <h2 style="margin:18px 0 6px">${title}</h2>
    <p style="color:#475569;line-height:1.5">Hi ${recipient.firstName || 'there'}, ${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="color:#64748b;padding:6px 0">Amount</td><td style="text-align:right;font-weight:700">${amountText}</td></tr>
      <tr><td style="color:#64748b;padding:6px 0">Reference</td><td style="text-align:right;font-family:monospace">${input.reference}</td></tr>
      <tr><td style="color:#64748b;padding:6px 0">Status</td><td style="text-align:right;font-weight:700;color:${paid ? '#059669' : '#dc2626'}">${paid ? 'Paid' : 'Rejected'}</td></tr>
    </table>
    <a href="${dashboardUrl}" style="display:inline-block;background:#1946dc;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">View payouts</a>
  </div>`;

    const text = `${title}\n\n${intro}\n\nAmount: ${amountText}\nReference: ${input.reference}\n\n${dashboardUrl}`;

    await this.sendEmail({
      to: recipient.email,
      subject: paid ? `Your withdrawal of ${amountText} is on its way` : 'Your withdrawal was not approved',
      html,
      text,
      tags: [
        { name: 'category', value: 'withdrawals' },
        { name: 'status', value: input.status.toLowerCase() },
      ],
    });
    return true;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Sent to the payer's email after they pay for an event. Uses the merchant's
   * custom subject/message/attachment when set, otherwise a branded default.
   * A "Powered by TchokoPay" footer is always appended.
   */
  async sendEventRegistrationEmail(input: {
    to: string;
    payerName?: string | null;
    eventTitle: string;
    businessName: string;
    amount: number;
    currency: string;
    reference: string;
    coverImageUrl?: string | null;
    logoUrl?: string | null;
    customSubject?: string | null;
    customMessage?: string | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
  }) {
    if (!input.to?.includes('@')) return false;

    const amountText = `${input.currency} ${new Intl.NumberFormat('en-US').format(input.amount)}`;
    const subject = input.customSubject?.trim() || `You're registered for ${input.eventTitle}`;
    const greeting = input.payerName ? `Hi ${this.escapeHtml(input.payerName)},` : 'Hi,';
    const bodyHtml = input.customMessage?.trim()
      ? this.escapeHtml(input.customMessage).replace(/\n/g, '<br/>')
      : `Your payment of ${amountText} for <strong>${this.escapeHtml(input.eventTitle)}</strong> has been received. You're all set &mdash; see you there!`;

    const cover = input.coverImageUrl
      ? `<img src="${input.coverImageUrl}" alt="" width="520" style="width:100%;max-width:520px;border-radius:14px;display:block;margin-bottom:18px"/>`
      : '';
    const logo = input.logoUrl
      ? `<img src="${input.logoUrl}" alt="" width="44" height="44" style="border-radius:11px;vertical-align:middle"/>`
      : '';

    const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1640">
    ${cover}
    <div style="margin-bottom:10px">${logo}<span style="font-weight:700;font-size:15px;vertical-align:middle;margin-left:8px">${this.escapeHtml(input.businessName)}</span></div>
    <span style="display:inline-block;background:#10b98122;color:#059669;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px">Payment received</span>
    <h2 style="margin:14px 0 6px">${this.escapeHtml(subject)}</h2>
    <p style="color:#475569;line-height:1.55">${greeting}</p>
    <p style="color:#475569;line-height:1.55">${bodyHtml}</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
      <tr><td style="color:#64748b;padding:6px 0">Event</td><td style="text-align:right;font-weight:700">${this.escapeHtml(input.eventTitle)}</td></tr>
      <tr><td style="color:#64748b;padding:6px 0">Amount paid</td><td style="text-align:right;font-weight:700">${amountText}</td></tr>
      <tr><td style="color:#64748b;padding:6px 0">Reference</td><td style="text-align:right;font-family:monospace">${input.reference}</td></tr>
    </table>
    ${input.attachmentUrl ? `<p style="color:#475569;font-size:13px">&#128206; Your ${this.escapeHtml(input.attachmentName || 'document')} is attached.</p>` : ''}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0">Powered by <a href="${this.getAppUrl()}" style="color:#1946dc;text-decoration:none;font-weight:600">TchokoPay</a></p>
  </div>`;

    const text = `${subject}\n\n${input.payerName ? `Hi ${input.payerName},\n` : ''}Your payment of ${amountText} for ${input.eventTitle} has been received.\nReference: ${input.reference}\n\nPowered by TchokoPay`;

    await this.sendEmail({
      to: input.to,
      subject,
      html,
      text,
      tags: [{ name: 'category', value: 'event-registration' }],
      attachments: input.attachmentUrl
        ? [{ filename: input.attachmentName || 'attachment.pdf', path: input.attachmentUrl }]
        : undefined,
    });
    return true;
  }

  private async sendEmail(input: EmailSendInput) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY', '');
    const from = this.configService.get<string>(
      'EMAIL_FROM',
      'TchokoPay <noreply@tchokopay.com>',
    );

    if (!apiKey) {
      this.logger.warn(
        `Email transport not configured. Logging preview for ${input.to} (${input.subject}).`,
      );
      this.logger.log(
        `EMAIL PREVIEW | to=${input.to} | subject=${input.subject}\n${input.text}`,
      );
      return { queued: false, provider: 'log' };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        tags: input.tags,
        attachments: input.attachments,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `Email send failed | to=${input.to} | subject=${input.subject} | status=${response.status} | body=${body}`,
      );
      throw new BadRequestException(
        'Unable to send email right now. Please try again.',
      );
    }

    this.logger.log(`Email queued | to=${input.to} | subject=${input.subject}`);
    return { queued: true, provider: 'resend' };
  }

  private async getPrimaryEmailRecipient(userId: string) {
    const contact = await this.prisma.userContact.findFirst({
      where: {
        userId,
        type: 'EMAIL',
        isVerified: true,
      },
      include: {
        user: {
          select: {
            firstName: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    if (!contact) {
      return null;
    }

    return {
      email: contact.value,
      firstName: contact.user.firstName,
    };
  }

  private getAppUrl() {
    return (
      this.configService.get<string>('FRONTEND_APP_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_APP_URL') ||
      'https://tchokopay.com'
    ).replace(/\/$/, '');
  }

  private getLogoUrl() {
    return (
      this.configService.get<string>('EMAIL_LOGO_URL') ||
      `${this.getAppUrl()}/tchokopay-logo.png`
    );
  }
}
