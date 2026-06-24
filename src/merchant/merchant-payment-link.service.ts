/* eslint-disable prettier/prettier */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QuoteService } from '../quote/quote.service.js';
import { UserSettingsService } from '../users/services/user-settings.service.js';
import { PaymentMethodEnum, FlowEnum } from '../quote/dto/create-quote.dto.js';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import cloudinary from '../config/cloudinary.config.js';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 5;

const LINK_SELECT = {
  id: true,
  slug: true,
  kind: true,
  reason: true,
  description: true,
  eventType: true,
  title: true,
  coverImageUrl: true,
  logoUrl: true,
  baseAmount: true,
  autoRoutePayout: true,
  isActive: true,
  expiresAt: true,
  createdAt: true,
  confirmEmailSubject: true,
  confirmEmailMessage: true,
  confirmEmailAttachmentUrl: true,
  confirmEmailAttachmentName: true,
  baseCurrency: { select: { code: true, symbol: true, name: true } },
  _count: { select: { invoices: true } },
} satisfies Prisma.MerchantPaymentLinkSelect;

type LinkRow = Prisma.MerchantPaymentLinkGetPayload<{ select: typeof LINK_SELECT }>;

@Injectable()
export class MerchantPaymentLinkService {
  constructor(
    private prisma: PrismaService,
    private quoteService: QuoteService,
    private userSettings: UserSettingsService,
  ) {}

  private async requireApprovedProfile(userId: string) {
    const profile = await this.prisma.merchantProfile.findUnique({ where: { userId } });
    if (!profile || profile.status !== 'APPROVED') {
      throw new ForbiddenException('Merchant access required');
    }
    return profile;
  }

  /** Human-readable kebab base derived from the merchant + reason, e.g. "tchoko-shop-rent-collection". */
  private slugBase(businessName: string, reason: string): string {
    const clean = (s: string) =>
      s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const biz = clean(businessName).split('-').slice(0, 2).join('-');
    const base = `${biz}-${clean(reason)}`.replace(/-+/g, '-').slice(0, 48).replace(/-+$/g, '');
    return base || 'pay';
  }

  private randomToken(): string {
    const bytes = randomBytes(TOKEN_LENGTH);
    let out = '';
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
    }
    return out;
  }

  /** Branded, readable, unique slug: "<business>-<reason>-<token>". */
  private async uniqueSlug(businessName: string, reason: string): Promise<string> {
    const base = this.slugBase(businessName, reason);
    for (let attempt = 0; attempt < 6; attempt++) {
      const slug = `${base}-${this.randomToken()}`;
      const existing = await this.prisma.merchantPaymentLink.findUnique({ where: { slug } });
      if (!existing) return slug;
    }
    throw new BadRequestException('Could not generate a unique link, please retry');
  }

  /** Shape a link row for the API (adds a derived `expired` flag). */
  private shape(link: LinkRow) {
    return {
      id: link.id,
      slug: link.slug,
      kind: link.kind,
      reason: link.reason,
      description: link.description,
      eventType: link.eventType,
      title: link.title,
      coverImageUrl: link.coverImageUrl,
      logoUrl: link.logoUrl,
      baseAmount: link.baseAmount,
      baseCurrency: link.baseCurrency,
      autoRoutePayout: link.autoRoutePayout,
      isActive: link.isActive,
      expiresAt: link.expiresAt,
      expired: link.expiresAt ? link.expiresAt.getTime() < Date.now() : false,
      paymentCount: link._count.invoices,
      createdAt: link.createdAt,
      confirmEmailSubject: link.confirmEmailSubject,
      confirmEmailMessage: link.confirmEmailMessage,
      confirmEmailAttachmentUrl: link.confirmEmailAttachmentUrl,
      confirmEmailAttachmentName: link.confirmEmailAttachmentName,
    };
  }

  async create(userId: string, dto: CreatePaymentLinkDto) {
    const profile = await this.requireApprovedProfile(userId);

    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.baseCurrency },
    });
    if (!currency || !currency.isActive) {
      throw new BadRequestException('Unsupported base currency');
    }

    const slug = await this.uniqueSlug(profile.businessName, dto.reason);
    const expiresAt = new Date(Date.now() + dto.durationDays * 24 * 60 * 60 * 1000);

    const link = await this.prisma.merchantPaymentLink.create({
      data: {
        merchantProfile: { connect: { id: profile.id } },
        slug,
        reason: dto.reason,
        description: dto.description ?? null,
        baseCurrency: { connect: { id: currency.id } },
        baseAmount: new Prisma.Decimal(dto.baseAmount),
        expiresAt,
      },
      select: LINK_SELECT,
    });

    return this.shape(link);
  }

  /** Upload an event image (cover banner or logo) to Cloudinary; returns its URL. */
  async uploadImage(userId: string, file: Express.Multer.File, kind: 'cover' | 'logo') {
    await this.requireApprovedProfile(userId);
    if (!file) throw new BadRequestException('No file uploaded');

    const result = await cloudinary.uploader.upload(
      `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      {
        folder: `tchokopay/events/${userId}`,
        transformation:
          kind === 'cover'
            ? [{ width: 1200, height: 480, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }]
            : [{ width: 400, height: 400, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }],
      },
    );
    return { url: result.secure_url as string };
  }

  /** Upload an attachment (e.g. ticket/receipt PDF) for the event confirmation email. */
  async uploadAttachment(userId: string, file: Express.Multer.File) {
    await this.requireApprovedProfile(userId);
    if (!file) throw new BadRequestException('No file uploaded');

    const result = await cloudinary.uploader.upload(
      `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      { folder: `tchokopay/events/${userId}/attachments`, resource_type: 'auto' },
    );
    return { url: result.secure_url as string, name: file.originalname || 'attachment' };
  }

  /** Update the merchant's custom confirmation-email content for an event. */
  async updateConfirmEmail(
    userId: string,
    id: string,
    dto: { subject?: string | null; message?: string | null; attachmentUrl?: string | null; attachmentName?: string | null },
  ) {
    const profile = await this.requireApprovedProfile(userId);
    const existing = await this.prisma.merchantPaymentLink.findFirst({
      where: { id, merchantProfileId: profile.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Event not found');

    const link = await this.prisma.merchantPaymentLink.update({
      where: { id },
      data: {
        confirmEmailSubject: dto.subject?.trim() || null,
        confirmEmailMessage: dto.message?.trim() || null,
        confirmEmailAttachmentUrl: dto.attachmentUrl?.trim() || null,
        confirmEmailAttachmentName: dto.attachmentName?.trim() || null,
      },
      select: LINK_SELECT,
    });
    return this.shape(link);
  }

  /** Create an EVENT (a payment link with event identity + branding). */
  async createEvent(userId: string, dto: CreateEventDto) {
    const profile = await this.requireApprovedProfile(userId);

    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.baseCurrency },
    });
    if (!currency || !currency.isActive) {
      throw new BadRequestException('Unsupported base currency');
    }

    const slug = await this.uniqueSlug(profile.businessName, dto.title);
    const expiresAt = new Date(Date.now() + dto.durationDays * 24 * 60 * 60 * 1000);

    const link = await this.prisma.merchantPaymentLink.create({
      data: {
        merchantProfile: { connect: { id: profile.id } },
        slug,
        kind: 'EVENT',
        reason: dto.collectLabel, // "what to collect" → reused as the reason
        title: dto.title,
        eventType: dto.eventType,
        description: dto.description ?? null,
        coverImageUrl: dto.coverImageUrl ?? null,
        logoUrl: dto.logoUrl ?? null,
        baseCurrency: { connect: { id: currency.id } },
        baseAmount: new Prisma.Decimal(dto.baseAmount),
        expiresAt,
      },
      select: LINK_SELECT,
    });

    return this.shape(link);
  }

  /**
   * Update an EVENT's details. Every field is optional. The slug (public URL)
   * is intentionally NEVER changed so shared links/QRs keep working, and price
   * changes only affect FUTURE registrations — already-settled payments are
   * untouched (we don't rewrite any existing invoice).
   */
  async updateEvent(userId: string, eventId: string, dto: UpdateEventDto) {
    const profile = await this.requireApprovedProfile(userId);
    const existing = await this.prisma.merchantPaymentLink.findFirst({
      where: { id: eventId, merchantProfileId: profile.id, kind: 'EVENT' },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Event not found');

    const data: Prisma.MerchantPaymentLinkUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.eventType !== undefined) data.eventType = dto.eventType;
    if (dto.collectLabel !== undefined) data.reason = dto.collectLabel;
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.coverImageUrl !== undefined) data.coverImageUrl = dto.coverImageUrl || null;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl || null;
    if (dto.baseAmount !== undefined) data.baseAmount = new Prisma.Decimal(dto.baseAmount);
    if (dto.baseCurrency !== undefined) {
      const currency = await this.prisma.currency.findUnique({ where: { code: dto.baseCurrency } });
      if (!currency || !currency.isActive) throw new BadRequestException('Unsupported base currency');
      data.baseCurrency = { connect: { id: currency.id } };
    }
    if (dto.durationDays !== undefined) {
      // Re-sets the registration window from now (lets a merchant extend an event).
      data.expiresAt = new Date(Date.now() + dto.durationDays * 24 * 60 * 60 * 1000);
    }

    const link = await this.prisma.merchantPaymentLink.update({
      where: { id: eventId },
      data,
      select: LINK_SELECT,
    });
    return this.shape(link);
  }

  async list(userId: string, kind?: 'LINK' | 'EVENT') {
    const profile = await this.requireApprovedProfile(userId);
    const links = await this.prisma.merchantPaymentLink.findMany({
      where: { merchantProfileId: profile.id, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
      select: LINK_SELECT,
    });

    // Collected (settlement currency) per link from successful payments.
    const paid = await this.prisma.paymentInvoice.findMany({
      where: { merchantProfileId: profile.id, paymentLinkId: { not: null }, status: 'SUCCESS' },
      select: { paymentLinkId: true, amount: true, currency: { select: { code: true } } },
    });
    const agg = new Map<string, { collected: number; count: number; code: string }>();
    for (const inv of paid) {
      const key = inv.paymentLinkId as string;
      const cur = agg.get(key) ?? { collected: 0, count: 0, code: inv.currency.code };
      cur.collected += Number(inv.amount);
      cur.count += 1;
      agg.set(key, cur);
    }

    return links.map((l) => {
      const a = agg.get(l.id);
      return {
        ...this.shape(l),
        collected: a ? Math.round(a.collected) : 0,
        collectedCurrency: a?.code ?? null,
        paidCount: a?.count ?? 0,
      };
    });
  }

  /** Payers (payments) for a link. */
  async getPayments(userId: string, linkId: string) {
    const profile = await this.requireApprovedProfile(userId);
    const link = await this.prisma.merchantPaymentLink.findFirst({
      where: { id: linkId, merchantProfileId: profile.id },
      select: { id: true },
    });
    if (!link) throw new NotFoundException('Payment link not found');

    const invoices = await this.prisma.paymentInvoice.findMany({
      where: { paymentLinkId: linkId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        reference: true,
        payerName: true,
        payerEmail: true,
        amount: true,
        status: true,
        createdAt: true,
        currency: { select: { code: true, symbol: true } },
      },
    });
    return invoices;
  }

  async getOne(userId: string, id: string) {
    const profile = await this.requireApprovedProfile(userId);
    const link = await this.prisma.merchantPaymentLink.findFirst({
      where: { id, merchantProfileId: profile.id },
      select: LINK_SELECT,
    });
    if (!link) throw new NotFoundException('Payment link not found');
    return this.shape(link);
  }

  async setActive(userId: string, id: string, isActive: boolean) {
    const profile = await this.requireApprovedProfile(userId);
    const existing = await this.prisma.merchantPaymentLink.findFirst({
      where: { id, merchantProfileId: profile.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Payment link not found');

    const link = await this.prisma.merchantPaymentLink.update({
      where: { id },
      data: { isActive },
      select: LINK_SELECT,
    });
    return this.shape(link);
  }

  // ── Public (payer-facing) ──────────────────────────────────────────────────

  /** Public view of a link/event for the checkout/registration page. */
  async getPublicLink(slug: string) {
    const link = await this.prisma.merchantPaymentLink.findUnique({
      where: { slug },
      include: {
        merchantProfile: { select: { businessName: true, status: true } },
        baseCurrency: { select: { code: true, symbol: true, name: true } },
      },
    });
    if (!link) throw new NotFoundException('Payment link not found');

    const expired = link.expiresAt ? link.expiresAt.getTime() < Date.now() : false;
    const merchantActive = link.merchantProfile.status === 'APPROVED';
    return {
      slug: link.slug,
      kind: link.kind,
      businessName: link.merchantProfile.businessName,
      reason: link.reason,
      description: link.description,
      // Event identity/branding (null for plain links)
      eventType: link.eventType,
      title: link.title,
      coverImageUrl: link.coverImageUrl,
      logoUrl: link.logoUrl,
      baseAmount: link.baseAmount,
      baseCurrency: link.baseCurrency,
      isActive: link.isActive,
      expired,
      payable: link.isActive && !expired && merchantActive,
    };
  }

  /** Resolve the verified payout a link's merchant settles to (storefront handle first, else primary). */
  private async resolveMerchantPayout(merchantProfileId: string, ownerUserId: string) {
    const identity = await this.prisma.paymentIdentity.findUnique({
      where: { merchantProfileId },
      select: { payoutSettingId: true, payoutSetting: { select: { id: true, isVerified: true } } },
    });

    let payoutId: string | null =
      identity?.payoutSetting?.isVerified ? identity.payoutSetting.id : null;

    if (!payoutId) {
      const primary = await this.userSettings.getPrimaryVerifiedPayoutSetting(ownerUserId);
      payoutId = primary?.id ?? null;
    }
    if (!payoutId) {
      throw new BadRequestException('This business cannot receive payments yet');
    }

    const payout = await this.prisma.userPaymentPhoneSettings.findUnique({
      where: { id: payoutId },
      include: { provider: true, country: { include: { currency: true } } },
    });
    if (!payout || !payout.isVerified) {
      throw new BadRequestException('This business cannot receive payments yet');
    }
    return payout;
  }

  /**
   * Create a per-payer REQUEST invoice from a link (tagged with the link +
   * merchant), with the merchant's settlement-currency target locked now.
   * The payer then settles it through the existing /pay flow.
   */
  async createInvoiceFromLink(slug: string, payerName?: string, payerEmail?: string) {
    const link = await this.prisma.merchantPaymentLink.findUnique({
      where: { slug },
      include: { merchantProfile: true, baseCurrency: true },
    });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.merchantProfile.status !== 'APPROVED') {
      throw new BadRequestException('This business is not available right now');
    }
    if (!link.isActive) throw new BadRequestException('This payment link is no longer active');
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This payment link has expired');
    }
    // Events require the registrant's name.
    if (link.kind === 'EVENT' && !payerName?.trim()) {
      throw new BadRequestException('Your name is required to register');
    }

    const payout = await this.resolveMerchantPayout(
      link.merchantProfileId,
      link.merchantProfile.userId,
    );
    const settlementCurrency = payout.country.currency;

    // Lock the merchant's settlement-currency value of the base amount now.
    const conversion = await this.quoteService.create({
      baseCurrency: link.baseCurrency.code,
      targetCurrency: settlementCurrency.code,
      amount: Number(link.baseAmount),
      amountType: 'PAY',
      paymentMethod: PaymentMethodEnum.MOMO, // placeholder — only the rate is used
      payoutMethod: PaymentMethodEnum.MOMO,
      flow: FlowEnum.REQUEST,
      // Only USD-priced events (for now) settle the merchant at the clean rate —
      // their platform fee/spread are charged to the PAYER at pay-time instead
      // of deducted from the merchant. All other base currencies are unchanged.
      cleanRate: link.baseCurrency.code === 'USD',
    });
    const targetAmount = new Prisma.Decimal(conversion.targetAmount);

    // Uppercase: getInvoiceByReference normalises references with toUpperCase().
    const reference = `REQ-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = link.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invoice = await this.prisma.paymentInvoice.create({
      data: {
        reference,
        amount: targetAmount,
        currency: { connect: { id: settlementCurrency.id } },
        // Events read better as "<Title> - <Registration>" (ASCII hyphen: the
        // payment provider rejects non-ASCII order info).
        description: link.kind === 'EVENT' && link.title ? `${link.title} - ${link.reason}` : link.reason,
        country: payout.country.iso2,
        paymentMethod: null, // payer chooses when settling
        payoutMethod: payout.paymentMethod,
        payoutProviderCode: payout.provider.providerCode,
        flow: 'REQUEST',
        recipient: { connect: { id: link.merchantProfile.userId } },
        recipientPhone: payout.phone,
        recipientName: link.merchantProfile.businessName,
        merchantProfile: { connect: { id: link.merchantProfileId } },
        merchantPaymentLink: { connect: { id: link.id } },
        payerName: payerName?.trim() || null,
        payerEmail: payerEmail?.trim() || null,
        expiresAt,
      },
      select: { reference: true },
    });

    return { reference: invoice.reference };
  }
}
