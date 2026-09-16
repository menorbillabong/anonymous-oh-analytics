// Match the existing server-side X import validation; never treat a URL as a handle.
export function normalizedXHandle(value: unknown): string {
  return String(value ?? '').trim().replace(/^@/, '');
}

export function validXHandle(value: unknown): boolean {
  return /^[A-Za-z0-9_]{1,15}$/.test(normalizedXHandle(value));
}
