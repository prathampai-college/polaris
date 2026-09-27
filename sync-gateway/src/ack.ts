import type { AckFrame } from '@polaris/shared';

const KNOWN = new Set<AckFrame['status']>(['APPLIED', 'APPLIED_LOCAL_WINS', 'DEDUPED', 'CONFLICT_CRITICAL', 'FAILED', 'RETRY']);

/** Map an HQ /sync/ingest response to the ACK status the tablet acts on.
 *  Transient (5xx/429/timeout) must be RETRY — marking it FAILED dead-lettered
 *  the write forever. Only a definitive 4xx is FAILED. */
export function ackStatusFor(httpStatus: number | null, body: Record<string, unknown>): AckFrame['status'] {
  const s = body.status as AckFrame['status'];
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) return KNOWN.has(s) ? s : 'APPLIED';
  if (httpStatus === null || httpStatus === 429 || httpStatus >= 500) return 'RETRY';
  if (httpStatus >= 400) return 'FAILED';
  return KNOWN.has(s) ? s : 'RETRY';
}
