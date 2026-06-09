import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** ผล WHOIS/RDAP — registrar + วันจดทะเบียน (ไว้คำนวณ AGE). null = ดึงไม่ได้/TLD ไม่รองรับ. */
export interface WhoisResult {
  registrar: string | null;
  createdAt: Date | null;
}

/** subset ของ RDAP response ที่เราอ่าน (field เป็น unknown → narrow เองแบบ type-safe). */
interface RdapResponse {
  entities?: unknown;
  events?: unknown;
}
interface RdapEntity {
  roles?: unknown;
  vcardArray?: unknown;
}
interface RdapEvent {
  eventAction?: unknown;
  eventDate?: unknown;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * WhoisService — lookup ผ่าน RDAP (Registration Data Access Protocol, แทน WHOIS เดิม: คืน JSON
 * มาตรฐาน). ยิงผ่าน HttpService (axios) ไป RDAP_BASE_URL (host คงที่ → SSRF-safe, axios ตาม
 * redirect ไป authoritative server เอง). best-effort: error/timeout/404 (ไม่พบ) → null ทั้งคู่
 * เพื่อไม่ให้รายงานทั้งก้อนพัง. .th และ ccTLD บางตัวไม่มี RDAP → คืน null (FE แสดง "—").
 */
@Injectable()
export class WhoisService {
  private readonly logger = new Logger(WhoisService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async lookup(domain: string): Promise<WhoisResult> {
    const host = this.normalize(domain);
    if (!host) return { registrar: null, createdAt: null };
    const base = this.config.get<string>('RDAP_BASE_URL') ?? 'https://rdap.org';
    const url = `${base.replace(/\/+$/, '')}/domain/${encodeURIComponent(host)}`;
    try {
      const res = await firstValueFrom(
        this.http.get<RdapResponse>(url, {
          timeout: 10_000,
          maxRedirects: 5,
          headers: { Accept: 'application/rdap+json, application/json' },
        }),
      );
      return {
        registrar: this.pickRegistrar(res.data),
        createdAt: this.pickCreated(res.data),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`RDAP lookup '${host}' failed: ${msg}`);
      return { registrar: null, createdAt: null };
    }
  }

  /** host จาก domain/URL (ตัด scheme/path/www) — null ถ้าว่าง. */
  private normalize(input: string): string | null {
    let h = (input ?? '').trim().toLowerCase();
    if (!h) return null;
    h = h
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    return h || null;
  }

  /** entity ที่ roles มี 'registrar' → ชื่อจาก vcardArray (['fn',{},'text','Name']). */
  private pickRegistrar(data: RdapResponse): string | null {
    const reg = asArray(data.entities).find((e) =>
      asArray((e as RdapEntity).roles).includes('registrar'),
    ) as RdapEntity | undefined;
    const vcard = asArray(reg?.vcardArray);
    const props = asArray(vcard[1]);
    const fn = asArray(props.find((p) => asArray(p)[0] === 'fn'));
    const name = fn[3];
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  }

  /** event ที่ eventAction='registration' → eventDate → Date (null ถ้า parse ไม่ได้). */
  private pickCreated(data: RdapResponse): Date | null {
    const reg = asArray(data.events).find(
      (e) => (e as RdapEvent).eventAction === 'registration',
    ) as RdapEvent | undefined;
    const d = reg?.eventDate;
    if (typeof d !== 'string') return null;
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
  }
}
