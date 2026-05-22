import { Injectable, Logger } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { NetwalletpayProvider } from '../providers/netwalletpay.provider.js';
import { BlinkApiService } from '../providers/services/blink-api.service.js';
import { PayoutExecutorService } from './payout-executor.service.js';
import { PaymentEventService } from './payment-event.service.js';

export type PollingProvider = 'netwalletpay' | 'blink';

export interface PayinPollJob {
  invoiceId: string;
  attemptId: string;
  externalRef: string;
  provider: PollingProvider;
  /** Blink only: BOLT11 payment request string needed for lnInvoicePaymentStatus query */
  blinkPaymentRequest?: string;
  maxAttempts?: number;
  intervalMs?: number;
}

export interface PayoutPollJob {
  invoiceId: string;
  payoutId: string;
  payoutAttemptId: string;
  externalRef: string;
  provider: PollingProvider;
  maxAttempts?: number;
  intervalMs?: number;
}

/** Alias kept for backwards compatibility */
export type PollJob = PayinPollJob;

/**
 * PaymentPollingService
 *
 * Sequentially polls provider status for BOTH the payin and the payout.
 * Works alongside the webhook path — whichever confirms first wins.
 * All DB writes are idempotent (re-checks status before writing).
 *
 * Default cadence: 24 polls × 5 s = 2 minutes per job.
 */
@Injectable()
export class PaymentPollingService {
  private readonly logger = new Logger(PaymentPollingService.name);

  constructor(
    private prisma: PrismaService,
    private netwalletpay: NetwalletpayProvider,
    private blinkApi: BlinkApiService,
    private payoutExecutor: PayoutExecutorService,
    private paymentEventService: PaymentEventService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC — PAYIN POLLING
  // ─────────────────────────────────────────────────────────────────────────

  /** Fire-and-forget: poll until payin is confirmed or times out. */
  start(job: PayinPollJob): void {
    const max = job.maxAttempts ?? 24;
    const interval = job.intervalMs ?? 5_000;
    this.logger.log(
      `Payin poll started | ${job.provider} | ref: ${job.externalRef} | up to ${max}×${interval / 1000}s`,
    );
    this.runPayinLoop(job, max, interval, 1).catch(err =>
      this.logger.error(`Payin poll crashed for ${job.externalRef}:`, err),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC — PAYOUT POLLING
  // ─────────────────────────────────────────────────────────────────────────

  /** Fire-and-forget: poll until payout is confirmed or times out. */
  startPayoutPoll(job: PayoutPollJob): void {
    const max = job.maxAttempts ?? 24;
    const interval = job.intervalMs ?? 5_000;
    this.logger.log(
      `Payout poll started | ${job.provider} | ref: ${job.externalRef} | up to ${max}×${interval / 1000}s`,
    );
    this.runPayoutLoop(job, max, interval, 1).catch(err =>
      this.logger.error(`Payout poll crashed for ${job.externalRef}:`, err),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE — PAYIN LOOP
  // ─────────────────────────────────────────────────────────────────────────

  private async runPayinLoop(
    job: PayinPollJob,
    maxAttempts: number,
    intervalMs: number,
    attempt: number,
  ): Promise<void> {
    // Stop if webhook already confirmed/failed
    const current = await this.prisma.paymentAttempt.findUnique({
      where: { id: job.attemptId },
      select: { status: true },
    });

    if (!current) return;

    if (current.status === TransactionStatus.SUCCESS) {
      this.logger.log(`Payin poll: ${job.attemptId} already SUCCESS (webhook confirmed first)`);
      return;
    }
    if (current.status === TransactionStatus.FAILED) {
      this.logger.log(`Payin poll: ${job.attemptId} already FAILED — stopping`);
      return;
    }

    const result = await this.checkProviderStatus(job.provider, job.externalRef, job.blinkPaymentRequest);

    if (result === 'SUCCESS') {
      this.logger.log(`Payin poll SUCCESS: ${job.externalRef} (check ${attempt}/${maxAttempts})`);
      await this.confirmPayin(job);
      return;
    }

    if (result === 'FAILED') {
      this.logger.log(`Payin poll FAILED: ${job.externalRef} (check ${attempt}/${maxAttempts})`);
      await this.failPayin(job, 'Provider returned FAILED');
      return;
    }

    if (attempt >= maxAttempts) {
      this.logger.warn(`Payin poll timed out after ${maxAttempts} checks for ${job.externalRef}`);
      await this.failPayin(job, 'Polling timed out — no confirmation received');
      return;
    }

    this.logger.log(`Payin poll PENDING: ${job.externalRef} (${attempt}/${maxAttempts}) — retry in ${intervalMs / 1000}s`);
    await this.sleep(intervalMs);
    await this.runPayinLoop(job, maxAttempts, intervalMs, attempt + 1);
  }

  private async confirmPayin(job: PayinPollJob): Promise<void> {
    // Guard: webhook may have fired between last check and now
    const current = await this.prisma.paymentAttempt.findUnique({
      where: { id: job.attemptId },
      select: { status: true },
    });
    if (current?.status === TransactionStatus.SUCCESS) return;

    await this.prisma.paymentAttempt.update({
      where: { id: job.attemptId },
      data: { status: TransactionStatus.SUCCESS },
    });

    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: job.attemptId },
      include: {
        currency: true,
        invoice: {
          include: {
            quote: {
              include: { baseCurrency: true, targetCurrency: true },
            },
          },
        },
      },
    });

    if (attempt) {
      await this.paymentEventService.emitPaymentComplete({
        invoiceId: attempt.invoiceId,
        invoiceReference: attempt.invoice.reference,
        status: 'PROCESSING',
        stage: 'PAYER_CONFIRMED',
        paymentMethod: attempt.method as string,
        payoutMethod: attempt.invoice.payoutMethod,
        amount: Number(attempt.amount),
        currency: attempt.currency.code,
        paymentDetails: { status: 'PAID', transactionId: job.externalRef },
        timestamp: new Date(),
        userId: attempt.invoice.createdById ?? undefined,
      });
    }

    // Trigger payout — idempotent, safe even if webhook also fires
    const payoutResult = await this.payoutExecutor.execute(job.invoiceId);

    // If the payout has an async transactionId, start payout polling.
    // IMPORTANT: use the *payout* method to resolve the provider, NOT the payin provider.
    // For Lightning payments the payin is via Blink but the payout (MOMO) is via Netwalletpay.
    // Using job.provider (Blink) for a MOMO payout would poll the wrong API → times out.
    if (payoutResult?.payoutAttemptId && payoutResult.payoutExternalRef) {
      const payoutPollingProvider = this.resolvePayoutProvider(
        attempt?.invoice?.payoutMethod ?? '',
      );
      this.startPayoutPoll({
        invoiceId: job.invoiceId,
        payoutId: payoutResult.payoutId,
        payoutAttemptId: payoutResult.payoutAttemptId,
        externalRef: payoutResult.payoutExternalRef,
        provider: payoutPollingProvider,
      });
    }
  }

  /** Map a payout method to the correct polling provider. */
  private resolvePayoutProvider(payoutMethod: string): PollingProvider {
    const m = (payoutMethod ?? '').toUpperCase();
    if (m === 'LIGHTNING' || m === 'BTC' || m === 'CRYPTO') return 'blink';
    return 'netwalletpay'; // MOMO, ORANGE, BANK, CARD all confirmed via Netwalletpay
  }

  private async failPayin(job: PayinPollJob, reason: string): Promise<void> {
    const current = await this.prisma.paymentAttempt.findUnique({
      where: { id: job.attemptId },
      select: { status: true },
    });
    if (current?.status !== TransactionStatus.PROCESSING) return;

    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: job.attemptId },
      include: {
        currency: true,
        invoice: true,
      },
    });

    await this.prisma.paymentAttempt.update({
      where: { id: job.attemptId },
      data: { status: TransactionStatus.FAILED, failureReason: reason },
    });
    await this.prisma.paymentInvoice.update({
      where: { id: job.invoiceId },
      data: { status: TransactionStatus.FAILED },
    });
    await this.prisma.paymentRequest.updateMany({
      where: {
        metadata: { path: ['invoiceId'], equals: job.invoiceId },
      },
      data: { status: TransactionStatus.FAILED },
    });

    if (attempt) {
      this.paymentEventService.emitPaymentComplete({
        invoiceId: attempt.invoiceId,
        invoiceReference: attempt.invoice.reference,
        status: 'FAILED',
        stage: 'FAILED',
        paymentMethod: attempt.method as string,
        payoutMethod: attempt.invoice.payoutMethod,
        amount: Number(attempt.amount),
        currency: attempt.currency.code,
        paymentDetails: {
          status: 'FAILED',
          transactionId: job.externalRef,
        },
        timestamp: new Date(),
        userId: attempt.invoice.createdById ?? undefined,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE — PAYOUT LOOP
  // ─────────────────────────────────────────────────────────────────────────

  private async runPayoutLoop(
    job: PayoutPollJob,
    maxAttempts: number,
    intervalMs: number,
    attempt: number,
  ): Promise<void> {
    // Stop if webhook already confirmed/failed
    const current = await this.prisma.payoutAttempt.findUnique({
      where: { id: job.payoutAttemptId },
      select: { status: true },
    });

    if (!current) return;

    if (current.status === TransactionStatus.SUCCESS) {
      this.logger.log(`Payout poll: ${job.payoutAttemptId} already SUCCESS (webhook confirmed first)`);
      return;
    }
    if (current.status === TransactionStatus.FAILED) {
      this.logger.log(`Payout poll: ${job.payoutAttemptId} already FAILED — stopping`);
      return;
    }

    const result = await this.checkProviderStatus(job.provider, job.externalRef);

    if (result === 'SUCCESS') {
      this.logger.log(`Payout poll SUCCESS: ${job.externalRef} (check ${attempt}/${maxAttempts})`);
      await this.confirmPayout(job);
      return;
    }

    if (result === 'FAILED') {
      this.logger.log(`Payout poll FAILED: ${job.externalRef} (check ${attempt}/${maxAttempts})`);
      await this.failPayout(job, 'Provider returned FAILED');
      return;
    }

    if (attempt >= maxAttempts) {
      this.logger.warn(`Payout poll timed out after ${maxAttempts} checks for ${job.externalRef}`);
      await this.failPayout(job, 'Polling timed out — payout not confirmed');
      return;
    }

    this.logger.log(`Payout poll PENDING: ${job.externalRef} (${attempt}/${maxAttempts}) — retry in ${intervalMs / 1000}s`);
    await this.sleep(intervalMs);
    await this.runPayoutLoop(job, maxAttempts, intervalMs, attempt + 1);
  }

  private async confirmPayout(job: PayoutPollJob): Promise<void> {
    // Guard: webhook may have confirmed between last check and now
    const current = await this.prisma.payoutAttempt.findUnique({
      where: { id: job.payoutAttemptId },
      select: { status: true },
    });
    if (current?.status === TransactionStatus.SUCCESS) return;

    await this.payoutExecutor.confirmPayout(job.externalRef);
    this.logger.log(`✅ Payout confirmed via polling: ${job.externalRef}`);
  }

  private async failPayout(job: PayoutPollJob, reason: string): Promise<void> {
    const current = await this.prisma.payoutAttempt.findUnique({
      where: { id: job.payoutAttemptId },
      select: { status: true },
    });
    if (current?.status !== TransactionStatus.PROCESSING) return;

    await this.payoutExecutor.failPayout(job.externalRef, reason);
    this.logger.warn(`Payout failed via polling: ${job.externalRef} — ${reason}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE — SHARED STATUS CHECK
  // ─────────────────────────────────────────────────────────────────────────

  private async checkProviderStatus(
    provider: PollingProvider,
    externalRef: string,
    blinkPaymentRequest?: string,
  ): Promise<'SUCCESS' | 'FAILED' | 'PENDING'> {
    try {
      if (provider === 'netwalletpay') {
        const { status } = await this.netwalletpay.checkTransactionStatus(externalRef);
        return status;
      }

      if (provider === 'blink') {
        if (!blinkPaymentRequest) {
          // No BOLT11 string available — can't poll Blink, rely on webhook only
          return 'PENDING';
        }
        const result = await this.blinkApi.getInvoiceStatus(blinkPaymentRequest);
        if (result.paid) return 'SUCCESS';
        const s = (result.status ?? '').toUpperCase();
        if (s === 'EXPIRED' || s === 'NOT_RECEIVED') return 'PENDING';
        if (s === 'CANCELLED') return 'FAILED';
        return 'PENDING';
      }

      return 'PENDING';
    } catch {
      return 'PENDING'; // transient errors are not failures
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
