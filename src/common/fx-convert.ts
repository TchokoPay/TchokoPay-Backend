/**
 * Lightweight FX helper for DISPLAY-ONLY totals: convert any currency amount to
 * an approximate XAF value so multi-currency balances can be summed for a single
 * headline figure (shown with a "≈"). One cached `/latest/XAF` fetch covers every
 * currency. Never use this for actual settlement — only for approximate totals.
 */
let cache: { at: number; rates: Record<string, number> } | null = null;
const TTL_MS = 60 * 60_000; // 1 hour

/** XAF → other-currency rates (conversion_rates from /latest/XAF). */
export async function getXafRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rates;
  try {
    const url = `${process.env.EXCHANGE_RATE_BASE_URL}/${process.env.EXCHANGE_RATE_API_KEY}/latest/XAF`;
    const res = await fetch(url);
    const data = (await res.json()) as { conversion_rates?: Record<string, number> };
    const rates = data?.conversion_rates ?? {};
    if (Object.keys(rates).length) cache = { at: Date.now(), rates };
    return rates;
  } catch {
    return cache?.rates ?? {};
  }
}

/** Approx XAF value of `amount` in `code`. Unknown currencies return 0 (excluded). */
export function toXaf(amount: number, code: string, rates: Record<string, number>): number {
  if (!amount) return 0;
  if (code === 'XAF') return amount;
  const r = rates[code]; // how many `code` per 1 XAF
  if (!r) return 0;
  return amount / r;
}

/** Sum a list of {amount, currency} into one approximate XAF total. */
export async function sumToXaf(items: Array<{ amount: number; currency: string }>): Promise<number> {
  const rates = await getXafRates();
  return Math.round(items.reduce((s, i) => s + toXaf(i.amount, i.currency, rates), 0));
}
