// iMessage handles: an E.164 number or an Apple ID email.
// Shared by the SQLite store (participants) and the blocklist (fingerprints),
// so one person maps to one participant and one fingerprint.

/** Phone handles in E.164 without formatting; email handles trimmed and lowercased. */
export function normalizeHandle(handle: string): string {
  const t = handle.trim();
  if (t.includes('@')) return t.toLowerCase();
  const digits = t.replace(/\D/g, '');
  return t.startsWith('+') ? `+${digits}` : digits;
}

/** `+15555550142` -> `***-***-0142`. */
export function maskNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '***-***-****';
  return `***-***-${digits.slice(-4).padStart(4, '*')}`;
}

/** `jane@icloud.com` -> `j***@icloud.com`; numbers as in `maskNumber`. */
export function maskHandle(handle: string): string {
  const at = handle.lastIndexOf('@');
  if (at > 0) return `${handle[0]}***@${handle.slice(at + 1)}`;
  return maskNumber(handle);
}
