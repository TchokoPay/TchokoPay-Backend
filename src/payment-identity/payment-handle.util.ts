export function normalizePaymentHandle(rawHandle: string): string {
  let normalized = (rawHandle || '').trim();

  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        break;
      }
      normalized = decoded;
    } catch {
      break;
    }
  }

  normalized = normalized.trim().toLowerCase().replace(/^@+/, '');

  return `@${normalized}`;
}
