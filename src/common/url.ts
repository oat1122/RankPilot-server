import { createHash } from 'node:crypto';

/**
 * URL canonicalization ที่ใช้ "ร่วมกัน" ระหว่าง flow [1] Crawler (ผู้เขียน pages.url +
 * pages.url_hash) และ flow [2] Ahrefs enrichment (join page_keywords ผ่าน url_hash).
 * ต้องเป็น logic เดียวกันเป๊ะ มิฉะนั้น sha1 ของสองฝั่งไม่ตรง → best-effort join พลาด
 * ทุกแถว (เอกสาร 01 pages / 03 §6). อนาคตย้ายไป packages/shared ให้ web ใช้ซ้ำได้.
 */

/**
 * normalize URL: http://, https:// เท่านั้น; เติม https:// ให้ bare domain
 * (เช่น 'example.com' → 'https://example.com/'); scheme อื่น (ftp/ws/file) → throw
 * UNSUPPORTED_URL (ไม่ mangle ทับ). ใช้ URL.toString() เป็นรูปมาตรฐาน.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  // มี scheme://อยู่แล้ว → ห้ามเติม https:// ทับ (ftp://x → https://ftp//x จะเพี้ยน);
  // ตรวจเฉพาะรูป scheme:// เพื่อไม่ชน bare domain ที่มี port (example.com:8080).
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    throw new Error(`UNSUPPORTED_URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error(`UNSUPPORTED_URL: ${raw}`);
  return parsed.toString();
}

/** sha1 ของ URL ที่ normalize แล้ว — ค่าเดียวกับที่ crawler เก็บใน pages.url_hash. */
export function urlHash(rawUrl: string): string {
  return createHash('sha1').update(normalizeUrl(rawUrl)).digest('hex');
}

/**
 * urlHash แบบ best-effort — คืน null ถ้า URL ว่าง/ใช้ไม่ได้ (scheme อื่น). สำหรับ caller
 * ที่ join แบบ optional เช่น enrichment (Ahrefs อาจคืน best_position_url ที่ไม่ใช่ http).
 */
export function urlHashOrNull(
  rawUrl: string | null | undefined,
): string | null {
  if (!rawUrl) return null;
  try {
    return urlHash(rawUrl);
  } catch {
    return null;
  }
}
