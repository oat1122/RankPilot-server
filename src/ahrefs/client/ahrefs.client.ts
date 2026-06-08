import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createHash } from 'node:crypto';
import type { AxiosResponse } from 'axios';
import { AppException, ErrorCode } from '../../common/http';
import { estimateUnits } from '../budget/cost';
import { currentPeriod } from '../budget/period';
import { BudgetGuard } from '../budget/budget.guard';
import { CacheLayer } from './cache.layer';
import { AhrefsRepo } from '../ahrefs.repo';
import { extractRowArray } from './rows';

/** input ของ 1 Ahrefs request ที่ผ่านทุกชั้น (cache→budget→http→settle). */
export interface AhrefsFetchOptions {
  projectId: number;
  endpoint: string; // relative เช่น 'site-explorer/organic-keywords'
  params: Record<string, unknown>;
  fields: string[]; // ใช้เป็น select + คิด cost
  expectedRows: number; // ใช้ประเมิน units ก่อนยิง
  ttlSec: number; // TTL cache ของ endpoint นี้
  cap: number; // เพดาน units/เดือนของโปรเจค
}

export interface AhrefsFetchResult<T = unknown> {
  data: T;
  unitsSpent: number; // 0 เมื่อ cached
  rows: number;
  cached: boolean;
}

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * AhrefsClient (facade — เอกสาร 03 §6) — ยิง Ahrefs API v3 ผ่านทุกชั้นความปลอดภัย:
 *   1) cache (CacheLayer) — เจอแล้วคืนเลย ไม่เสีย units
 *   2) reserve (BudgetGuard) — กันงบเกินก่อนยิง
 *   3) HTTP GET (Bearer key, select แคบ) — validateStatus เองเพื่อ map error เป็น AppException
 *   4) settle ด้วย units จริง (header x-units-cost) + เขียน cache + bump usage
 *
 * เรียกจาก worker เท่านั้น (ผ่าน EnrichmentService → AhrefsProcessor) ตามกฎ api ≠ worker.
 */
@Injectable()
export class AhrefsClient {
  private readonly logger = new Logger(AhrefsClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly budget: BudgetGuard,
    private readonly cache: CacheLayer,
    private readonly repo: AhrefsRepo,
  ) {}

  async fetch<T = unknown>(
    opts: AhrefsFetchOptions,
  ): Promise<AhrefsFetchResult<T>> {
    const paramsHash = this.hashParams(opts.endpoint, opts.params, opts.fields);

    // 1) cache — hit แล้วจบ ไม่แตะงบ/network
    const cached = await this.cache.get(opts.endpoint, paramsHash);
    if (cached !== null) {
      return {
        data: cached as T,
        unitsSpent: 0,
        rows: this.rowCount(cached),
        cached: true,
      };
    }

    // ต้องมี key ก่อนยิงจริง (cache hit ไม่ต้องใช้ key → เช็คหลัง cache)
    const apiKey = this.config.get<string>('AHREFS_API_KEY');
    if (!apiKey) {
      throw new AppException(
        ErrorCode.AHREFS_UNAUTHORIZED,
        'AHREFS_API_KEY is not set — set it to call Ahrefs API',
      );
    }

    const period = currentPeriod();
    const estimate = estimateUnits(opts.fields, opts.expectedRows);

    // 2) จองงบ (throw AHREFS_BUDGET_EXCEEDED ถ้าเกิน)
    await this.budget.reserve(opts.projectId, period, estimate, opts.cap);

    // 3) ยิงจริง — refund ถ้าล้ม
    let res: AxiosResponse;
    try {
      res = await this.request(opts, apiKey);
    } catch (err) {
      await this.refund(opts.projectId, period, estimate);
      const reason = err instanceof Error ? err.message : String(err);
      throw new AppException(
        ErrorCode.AHREFS_API_ERROR,
        `Ahrefs request failed: ${reason}`,
      );
    }

    await this.assertOk(res, opts.projectId, period, estimate);

    // 4) units จริง + นับ rows + settle/cache/usage
    const actual = this.actualUnits(res, estimate);
    const rows = this.rowCount(res.data);
    await this.budget.settle(opts.projectId, period, estimate, actual);
    await this.cache.set({
      endpoint: opts.endpoint,
      paramsHash,
      response: res.data,
      unitsSpent: actual,
      rows,
      ttlSec: opts.ttlSec,
    });
    await this.repo.bumpUsage(opts.projectId, period, actual);
    this.logger.log(
      `ahrefs ${opts.endpoint} ok rows=${rows} units=${actual} (est=${estimate})`,
    );

    return { data: res.data as T, unitsSpent: actual, rows, cached: false };
  }

  private async request(
    opts: AhrefsFetchOptions,
    apiKey: string,
  ): Promise<AxiosResponse> {
    const baseUrl = this.config.get<string>('AHREFS_API_BASE_URL')!;
    const url = `${baseUrl.replace(/\/+$/, '')}/${opts.endpoint.replace(/^\/+/, '')}`;
    // ส่ง select เฉพาะเมื่อมี fields — endpoint แบบ fixed-object (domain-rating, backlinks-stats,
    // metrics) ไม่รับ param `select`; ส่งไปจะโดน 400. fields:[] = "endpoint นี้ไม่ใช้ select".
    const params: Record<string, unknown> = { ...opts.params };
    if (opts.fields.length > 0) params.select = opts.fields.join(',');
    return firstValueFrom(
      this.http.get(url, {
        params,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true, // map status เองด้านล่าง
      }),
    );
  }

  /** map HTTP status ที่ไม่ใช่ 2xx → AppException + คืนงบที่จองไว้ก่อน throw. */
  private async assertOk(
    res: AxiosResponse,
    projectId: number,
    period: string,
    estimate: number,
  ): Promise<void> {
    if (res.status >= 200 && res.status < 300) return;
    await this.refund(projectId, period, estimate);
    // Ahrefs ใส่สาเหตุจริง (เช่น "Unknown column 'difficulty'") ไว้ใน body — ก่อนแก้โค้ดทิ้ง
    // res.data ทั้งก้อน เหลือแต่ "HTTP 400" → debug ไม่ได้. แนบ reason เข้า message + details +
    // log.error เพื่อให้ทั้ง log และ FE (job.failedReason = err.message) เห็นว่า field/param ไหนผิด.
    const reason = this.describeAhrefsError(res.data);
    const endpoint = res.config?.url ?? 'ahrefs';
    this.logger.error(`ahrefs ${endpoint} HTTP ${res.status}${reason}`);
    if (res.status === 401 || res.status === 403) {
      throw new AppException(
        ErrorCode.AHREFS_UNAUTHORIZED,
        `Ahrefs auth failed (HTTP ${res.status})${reason}`,
        res.data,
      );
    }
    if (res.status === 429) {
      throw new AppException(
        ErrorCode.AHREFS_RATE_LIMITED,
        `Ahrefs API rate limited (HTTP 429)${reason}`,
        res.data,
      );
    }
    throw new AppException(
      ErrorCode.AHREFS_API_ERROR,
      `Ahrefs API error (HTTP ${res.status})${reason}`,
      res.data,
    );
  }

  /**
   * สรุป error body ของ Ahrefs เป็นข้อความสั้นนำหน้าด้วย ": " (ต่อท้าย message ได้ตรง ๆ).
   * รองรับ { error } / { message } / { errors } / string / object อื่น (stringify) — คืน ''
   * ถ้าว่าง. ตัดที่ ~300 ตัวอักษรกัน message/log ยาวเกิน.
   */
  private describeAhrefsError(data: unknown): string {
    if (data == null) return '';
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (typeof data === 'number' || typeof data === 'boolean') {
      text = String(data);
    } else if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const msg = obj.error ?? obj.message ?? obj.errors;
      text = typeof msg === 'string' ? msg : JSON.stringify(obj);
    } else {
      return ''; // symbol/function/bigint — ไม่ใช่ body ที่คาด, ข้าม
    }
    text = text.trim();
    if (!text) return '';
    const MAX = 300;
    return `: ${text.length > MAX ? `${text.slice(0, MAX)}…` : text}`;
  }

  /**
   * คืนงบที่จองไว้ (settle actual=0) แบบ best-effort. refund ที่ล้ม (เช่น Redis ล่ม
   * พอดีตอน error handling) ต้อง "ไม่กลบ" error เดิม (typed AHREFS_* ที่ FE ใช้ branch)
   * และต้องไม่หลุดเป็น unhandled rejection (เคยล้ม worker process — เหตุผลเดียวกับ
   * 'error' listener ของ RedisModule). ground truth ที่ ahrefs_usage reconcile ทีหลัง.
   */
  private async refund(
    projectId: number,
    period: string,
    estimate: number,
  ): Promise<void> {
    await this.budget.settle(projectId, period, estimate, 0).catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `budget refund failed (project ${projectId}, ${period}): ${reason}`,
      );
    });
  }

  /** sha1(endpoint + params + fields) — key ของ cache (เอกสาร 03 §6). */
  private hashParams(
    endpoint: string,
    params: Record<string, unknown>,
    fields: string[],
  ): string {
    const basis = `${endpoint}|${JSON.stringify(params)}|${[...fields].sort().join(',')}`;
    return createHash('sha1').update(basis).digest('hex');
  }

  /** units จริงจาก header x-units-cost (fallback = ที่ประเมิน). */
  private actualUnits(res: AxiosResponse, fallback: number): number {
    const header = res.headers?.['x-units-cost'] as
      | string
      | string[]
      | undefined;
    const raw = Array.isArray(header) ? header[0] : header;
    // แยก "ไม่มี header/ว่าง" (→ fallback = ที่ประเมิน) ออกจาก "x-units-cost: 0" จริง (→ 0).
    // ก่อนแก้ใช้ n > 0 → response ที่คิด 0 unit จริง (เช่น cached ฝั่ง Ahrefs) ถูก fallback เป็น
    // estimate ทำให้ settle/bumpUsage คิดงบเกินจริง.
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /** นับ rows ด้วย logic เดียวกับ EnrichmentService (extractRowArray) — กัน rows ≠ fetched. */
  private rowCount(data: unknown): number {
    return extractRowArray(data).length;
  }
}
