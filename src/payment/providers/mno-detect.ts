/**
 * Mobile Network Operator (MNO) detection from phone number prefixes.
 *
 * Returns the Netwalletpay providerCode that matches the subscriber's actual
 * network, derived from the ITU/national prefix allocation for each country.
 *
 * Sources: Communications Authority of Kenya, TCRA Tanzania, UCC Uganda,
 * ART Cameroon — verified against Netwalletpay provider codes.
 */

/**
 * Detect the Netwalletpay provider code for a given phone number.
 *
 * @param phone  Full international number (e.g. "254775571778") — no + sign
 * @param iso2   ISO2 country code (e.g. "KE")
 * @returns providerCode or null if detection is not possible
 */
export function detectProviderFromPhone(
  phone: string,
  iso2: string,
): string | null {
  const digits = phone.replace(/\D/g, '');

  switch (iso2.toUpperCase()) {
    // ── Kenya (KE) ──────────────────────────────────────────────────────────
    // Strip +254 → get 9-digit local number
    case 'KE': {
      const local = digits.startsWith('254') ? digits.slice(3) : digits;
      const p3 = local.slice(0, 3); // first 3 local digits
      const p4 = local.slice(0, 4); // first 4 (for fine-grained splits)

      // Airtel Kenya allocations (Communications Authority Kenya 2024):
      //   073X (0730–0739)
      //   075X (0750–0756 only — 0757+ is Safaricom)
      //   078X (0780–0784 — 0785+ is Safaricom)
      if (p3 === '073' || p3 === '078') return 'airtel_ke';
      if (p3 === '075' && parseInt(local[3] ?? '9') <= 6) return 'airtel_ke';
      // Safaricom M-Pesa: everything else (070–072, 074, 075[7-9], 076, 077, 079, 01X)
      if (local.length >= 7) return 'mpesa_ke';
      return null;
    }

    // ── Tanzania (TZ) ───────────────────────────────────────────────────────
    // Strip +255 → get 9-digit local number
    case 'TZ': {
      const local = digits.startsWith('255') ? digits.slice(3) : digits;
      const p3 = local.slice(0, 3);

      if (['074', '075', '076'].includes(p3)) return 'vodacom_tz'; // Vodacom M-Pesa
      if (['068', '069', '078', '079'].includes(p3)) return 'airtel_tz'; // Airtel
      if (['065', '067', '077'].includes(p3)) return 'tigo_tz';          // Tigo Pesa
      if (['062', '063'].includes(p3)) return 'azampesa_tz';             // AzamPesa
      if (p3 === '035') return 'halopesa_tz';                            // HaloPesa
      return 'vodacom_tz'; // most-common fallback for TZ
    }

    // ── Uganda (UG) ─────────────────────────────────────────────────────────
    // Strip +256 → get 9-digit local number
    case 'UG': {
      const local = digits.startsWith('256') ? digits.slice(3) : digits;
      const p3 = local.slice(0, 3);

      if (['039', '076', '077', '078'].includes(p3)) return 'mtn_ug';  // MTN
      if (['070', '072', '075'].includes(p3)) return 'airtel_ug';      // Airtel
      return 'mtn_ug'; // largest network in UG
    }

    // ── Cameroon (CM) ───────────────────────────────────────────────────────
    // Strip +237 → get 9-digit local number
    case 'CM': {
      const local = digits.startsWith('237') ? digits.slice(3) : digits;
      const p3 = local.slice(0, 3);

      // Orange Money: 655–657, 690–699
      if (['655', '656', '657'].includes(p3)) return 'orange_cm';
      if (p3.startsWith('69')) return 'orange_cm';

      // MTN MoMo: 65X (not 655–657), 67X, 68X
      return 'mtn_cm';
    }

    // ── All other countries — no mapping, caller uses its own logic ──────────
    default:
      return null;
  }
}
