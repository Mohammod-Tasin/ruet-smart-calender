/** Neon pooled hosts look like `ep-xxx-pooler.region.aws.neon.tech`. */
export function toDirectUrl(pooled: string): string {
  const u = new URL(pooled);
  u.hostname = u.hostname.replace('-pooler', '');
  return u.toString();
}

export function toPooledUrl(url: string): string {
  const u = new URL(url);
  const [first = '', ...rest] = u.hostname.split('.');
  if (!first.endsWith('-pooler')) u.hostname = [`${first}-pooler`, ...rest].join('.');
  return u.toString();
}

export function requireOwnerUrl(): string {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('DATABASE_URL_OWNER is not set (put it in .env.local)');
  return url;
}
