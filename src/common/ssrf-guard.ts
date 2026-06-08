import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF guard — กัน crawler (flow [1]) ถูกใช้ยิง request เข้า resource ภายใน.
 *
 * crawler รับ URL จากผู้ใช้แล้ว fetch ตรง (crawler.service.crawl) + ส่ง body กลับ caller
 * ผ่าน GET /crawls/:id ⇒ ถ้าไม่กรอง host ผู้ใช้ยิง 127.0.0.1:6379 (Redis), 169.254.169.254
 * (cloud metadata), 10/172.16/192.168 (LAN), ::1 ฯลฯ แล้วอ่าน response กลับได้ = read-SSRF.
 *
 * กันสองชั้น (defense in depth) — normalizeUrl เช็คแค่ scheme http(s) เท่านั้น ไม่พอ:
 *  1. assertPublicUrl/assertHostAllowed — เช็ค host ที่เป็น IP-literal + ชื่อ loopback
 *     ก่อนยิง และทุก redirect hop (beforeRedirect). กัน http://127.0.0.1, redirect→IP ตรง.
 *  2. ssrfSafe{Http,Https}Agent — custom dns lookup ตรวจ IP ที่ "จะ connect จริง"
 *     ก่อนต่อ socket. กัน hostname ที่ resolve ไป private IP (DNS rebinding) + redirect
 *     ไปโดเมนที่ชี้ภายใน. keepAlive:false → re-resolve ทุก request (ไม่ reuse socket ข้าม host).
 *
 * เฉพาะ crawler เท่านั้น — PSI/Ahrefs/OpenRouter/Voyage ยิง base URL คงที่จาก env (ไม่ใช่ SSRF).
 */

/** แปลง IPv4 dotted → uint32 (null ถ้าไม่ใช่รูป a.b.c.d หรือ octet เกิน 255). */
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

/** CIDR ของ IPv4 ที่ห้าม fetch (loopback/private/link-local/CGNAT/reserved/doc/multicast). */
const V4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this host" / unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (RFC 6598)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (รวม cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1 (doc)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2 (doc)
  ['203.0.113.0', 24], // TEST-NET-3 (doc)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
  ['255.255.255.255', 32], // broadcast
];

function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  return V4_BLOCKS.some(([base, bits]) => {
    const b = ipv4ToInt(base);
    if (b == null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  });
}

/**
 * IP (v4/v6 literal) อยู่ในช่วงที่ห้าม fetch ไหม. host ที่ไม่ใช่ IP literal → false
 * (ปล่อยให้ ssrfSafeLookup เช็คตอน resolve). v6 เช็คช่วงอันตรายหลัก + mapped-v4.
 */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return v4Blocked(ip);
  if (v === 6) {
    const lower = ip.toLowerCase().split('%')[0]; // ตัด zone id (fe80::1%eth0)
    // IPv4-mapped/embedded (::ffff:127.0.0.1, ::127.0.0.1) → ตรวจ v4 ที่ฝังอยู่
    const embedded = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
    if (embedded && v4Blocked(embedded[1])) return true;
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd]/.test(lower)) return true; // unique-local fc00::/7
    if (lower.startsWith('ff')) return true; // multicast ff00::/8
    return false;
  }
  return false;
}

/**
 * host (IP literal หรือชื่อ) อนุญาตให้ fetch ไหม — โยน Error('SSRF_BLOCKED…') ถ้าไม่.
 * ชื่อ DNS ทั่วไปผ่านชั้นนี้ (resolve จริงค่อยถูกเช็คโดย ssrfSafeLookup) ยกเว้นชื่อ loopback ชัด ๆ.
 */
export function assertHostAllowed(host: string | null | undefined): void {
  if (!host) throw new Error('SSRF_BLOCKED: empty host');
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // [::1] → ::1
  if (isIP(h)) {
    if (isBlockedIp(h))
      throw new Error(`SSRF_BLOCKED: ${host} (private/reserved IP)`);
    return;
  }
  if (h === 'localhost' || h.endsWith('.localhost'))
    throw new Error(`SSRF_BLOCKED: ${host} (loopback hostname)`);
}

/** parse URL แล้วเช็ค host — โยน Error('SSRF_BLOCKED…') ถ้า host ภายใน/ใช้ไม่ได้. */
export function assertPublicUrl(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF_BLOCKED: invalid url ${rawUrl}`);
  }
  assertHostAllowed(u.hostname);
}

/**
 * dns.lookup ที่ปฏิเสธ IP ภายใน — ส่งให้ http/https Agent ใช้ตอนต่อ socket. ส่ง options เดิม
 * ต่อให้ dns เพื่อให้ callback shape ตรงกับที่ net ขอ (all=true → array). net จะ connect ไป
 * "IP ที่เราคืน" เท่านั้น ⇒ ตรวจตรงนี้ = กัน DNS rebinding (resolve→เช็ค→connect เป็นค่าเดียวกัน).
 */
export function ssrfSafeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, address, family);
    if (options?.all) {
      const addrs = address as unknown as LookupAddress[];
      const bad = addrs.find((a) => isBlockedIp(a.address));
      if (bad)
        return callback(
          new Error(`SSRF_BLOCKED: ${hostname} → ${bad.address}`),
          [],
        );
      return callback(null, addrs, family);
    }
    const addr = address as unknown as string;
    if (isBlockedIp(addr))
      return callback(new Error(`SSRF_BLOCKED: ${hostname} → ${addr}`), '');
    return callback(null, addr, family);
  });
}

// keepAlive:false → ทุก request resolve ใหม่ผ่าน ssrfSafeLookup (ไม่ reuse socket ข้าม host).
const agentOptions = { keepAlive: false, lookup: ssrfSafeLookup };
export const ssrfSafeHttpAgent = new HttpAgent(agentOptions);
export const ssrfSafeHttpsAgent = new HttpsAgent(agentOptions);
