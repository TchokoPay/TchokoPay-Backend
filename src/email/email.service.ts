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
