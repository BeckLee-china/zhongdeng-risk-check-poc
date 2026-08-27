const PUNCT = /[\s·•()（）\[\]【】{}<>《》“”‘’'"，,。.;；:：/\\_-]+/g;

export function normalizeText(input?: string): string {
  return (input ?? "")
    .trim()
    .toUpperCase()
    .replace(PUNCT, "")
    .replace(/有限责任公司/g, "有限公司")
    .replace(/股份有限责任公司/g, "股份有限公司");
}

export function normalizeIdentifier(input?: string): string {
  return (input ?? "").trim().toUpperCase().replace(/[\s\-_/\\\.]/g, "");
}

export function sameIdentifier(a?: string, b?: string): boolean {
  const na = normalizeIdentifier(a);
  const nb = normalizeIdentifier(b);
  return Boolean(na && nb && na === nb);
}

function bigrams(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const out: string[] = [];
  for (let i = 0; i < normalized.length - 1; i += 1) out.push(normalized.slice(i, i + 2));
  return out;
}

export function diceSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb && na) return 1;
  const aa = bigrams(na);
  const bb = bigrams(nb);
  if (!aa.length || !bb.length) return 0;
  const counts = new Map<string, number>();
  for (const token of aa) counts.set(token, (counts.get(token) ?? 0) + 1);
  let intersection = 0;
  for (const token of bb) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      counts.set(token, count - 1);
    }
  }
  return (2 * intersection) / (aa.length + bb.length);
}

export function almostEqualAmount(a?: number, b?: number): boolean {
  if (a == null || b == null) return false;
  const tolerance = Math.max(1, Math.abs(a) * 0.001);
  return Math.abs(a - b) <= tolerance;
}

export function dateDistanceDays(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.abs(da.getTime() - db.getTime()) / 86_400_000;
}
