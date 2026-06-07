import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';

/** Core Web Vitals ที่เก็บใน page_snapshots (เอกสาร 01 §2) — null = ไม่มีข้อมูล. */
export interface CrawlCwv {
  lcpMs: number | null;
  clsX1000: number | null; // CLS × 1000 (column cls_x1000)
  inpMs: number | null;
}

const EMPTY_CWV: CrawlCwv = { lcpMs: null, clsX1000: null, inpMs: null };

/** รูป response PSI v5 เท่าที่ใช้ (field = CrUX, lab = Lighthouse). */
interface PsiResponse {
  loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
  lighthouseResult?: { audits?: Record<string, { numericValue?: number }> };
}

/**
 * PsiService — ดึง Core Web Vitals จาก PageSpeed Insights API v5 (เอกสาร 01 page_snapshots
 * lcp/cls/inp "จาก PSI API"). best-effort: PSI_ENABLED=false / non-2xx / timeout / parse ล้ม
 * → คืน null ทุกตัว ไม่ throw (CWV ล้มต้องไม่ทำให้ persist crawl ล้ม). gated ด้วย PSI_ENABLED
 * ∵ call ช้า 10-30s/หน้า — default ปิดเพื่อไม่หน่วง crawl ปกติ.
 */
@Injectable()
export class PsiService {
  private readonly logger = new Logger(PsiService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async cwv(url: string): Promise<CrawlCwv> {
    if (this.config.get<boolean>('PSI_ENABLED') !== true) return EMPTY_CWV;

    const baseUrl = this.config.get<string>('PSI_BASE_URL')!;
    const strategy = this.config.get<string>('PSI_STRATEGY') ?? 'mobile';
    const apiKey = this.config.get<string>('PSI_API_KEY');
    const timeout = this.config.get<number>('PSI_TIMEOUT_MS') ?? 30_000;

    let res: AxiosResponse<PsiResponse>;
    try {
      res = await firstValueFrom(
        this.http.get<PsiResponse>(baseUrl, {
          params: {
            url,
            strategy,
            category: 'performance',
            ...(apiKey ? { key: apiKey } : {}),
          },
          timeout,
          validateStatus: () => true, // จับ status เอง → ไม่ throw, map เป็น null
        }),
      );
    } catch (err) {
      this.warn(url, err);
      return EMPTY_CWV;
    }

    if (res.status < 200 || res.status >= 300) {
      this.warn(url, `HTTP ${res.status}`);
      return EMPTY_CWV;
    }

    try {
      return this.mapCwv(res.data);
    } catch (err) {
      this.warn(url, err);
      return EMPTY_CWV;
    }
  }

  /**
   * map PSI v5 → CWV: field (CrUX, real-user) ก่อน แล้ว fallback lab (Lighthouse).
   * - LCP/INP: field.percentile เป็น ms อยู่แล้ว; lab.numericValue เป็น ms (ปัด).
   * - CLS: field.percentile = CLS×100 → ×10 ได้ ×1000 ; lab.numericValue = CLS (เช่น 0.05) → ×1000.
   */
  private mapCwv(data: PsiResponse): CrawlCwv {
    const field = data.loadingExperience?.metrics ?? {};
    const lab = data.lighthouseResult?.audits ?? {};

    const lcpMs =
      this.finite(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile) ??
      this.round(lab['largest-contentful-paint']?.numericValue);
    const inpMs =
      this.finite(field.INTERACTION_TO_NEXT_PAINT?.percentile) ??
      this.round(lab['interaction-to-next-paint']?.numericValue);

    const fieldCls = this.finite(
      field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile,
    );
    const labCls = lab['cumulative-layout-shift']?.numericValue;
    const clsX1000 =
      fieldCls != null
        ? fieldCls * 10
        : this.round(typeof labCls === 'number' ? labCls * 1000 : undefined);

    return { lcpMs, clsX1000, inpMs };
  }

  private finite(v: number | undefined): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  private round(v: number | undefined): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  }

  private warn(url: string, err: unknown): void {
    const reason =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    this.logger.warn(`PSI cwv ล้ม (best-effort, คืน null) ${url}: ${reason}`);
  }
}
