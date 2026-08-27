export const ALLOWED: Record<string, string[]> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['DISPATCHED'],
  DISPATCHED: ['RECEIVED'],
};

export function canTransition(cur: string, next: string): boolean {
  return (ALLOWED[cur] ?? []).includes(next);
}
