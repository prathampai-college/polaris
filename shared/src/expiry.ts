export function isExpiringSoon(expiry: string | null): boolean {
  if (!expiry) return false;
  const ms = new Date(expiry).getTime() - Date.now();
  // expiring soon = 0..30 days in future, exclusive of already expired
  return ms >= 0 && ms < 30 * 86400000;
}

export function isExpired(expiry: string | null): boolean {
  if (!expiry) return false;
  return new Date(expiry).getTime() < Date.now();
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
