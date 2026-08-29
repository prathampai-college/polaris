export function isExpiringSoon(expiry: string | null): boolean {
  if (!expiry) return false;
  const t = new Date(expiry).getTime();
  if (Number.isNaN(t)) return false;
  const ms = t - Date.now();
  return ms >= 0 && ms < 30 * 86400000;
}

export function isExpired(expiry: string | null): boolean {
  if (!expiry) return false;
  const t = new Date(expiry).getTime();
  if (Number.isNaN(t)) return true; // invalid date → treat as expired (fail-safe)
  return t < Date.now();
}

export function daysUntilExpiry(expiry: string | null): number | null {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
}

export function expiryStatus(expiry: string | null): 'ok' | 'expiring' | 'expired' | 'no_expiry' {
  if (!expiry) return 'no_expiry';
  if (isExpired(expiry)) return 'expired';
  if (isExpiringSoon(expiry)) return 'expiring';
  return 'ok';
}
