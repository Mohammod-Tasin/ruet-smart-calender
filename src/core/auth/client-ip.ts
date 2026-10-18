interface HeaderReader {
  get(name: string): string | null;
}

// Most trustworthy first. On Vercel the platform sets/overwrites all three, so a client
// cannot spoof them; anywhere else they are caller-controlled.
const IP_HEADERS = ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for'];

// Loose shape check (IPv4 / IPv6 characters, max 45) so junk can't flood login_attempts.
const looksLikeIp = (s: string) => /^[0-9a-fA-F:.]{2,45}$/.test(s) && /[.:]/.test(s);

export function getClientIp(headers: HeaderReader): string {
  for (const name of IP_HEADERS) {
    const first = headers.get(name)?.split(',')[0]?.trim();
    if (first && looksLikeIp(first)) return first;
  }
  return 'unknown';
}
