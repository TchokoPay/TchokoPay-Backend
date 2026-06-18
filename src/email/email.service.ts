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
