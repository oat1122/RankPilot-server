import { Injectable } from '@nestjs/common';
import { TrendsRepo } from './trends.repo';
import type { TrendWindow } from './trends.repo';
import type { TrendsQueryDto } from './dto/trends-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * TrendsService — บาง: คำนวณ window (default 30 วันล่าสุด) แล้ว delegate repo + coerce AVG/SUM
 * (mysql2 คืน DECIMAL เป็น string) เป็น number. read เบา รันใน request thread ได้ (เอกสาร 00 §4).
 */
@Injectable()
export class TrendsService {
  constructor(private readonly repo: TrendsRepo) {}

  async scoreTrend(projectId: number, query: TrendsQueryDto) {
    const window = this.window(query);
    const rows = await this.repo.scoreTrend(projectId, window);
    const points = rows.map((r) => ({
      crawlId: r.crawlId,
      createdAt: r.createdAt,
      pagesCrawled: r.pagesCrawled,
      avgHealthScore: this.round(r.avgHealthScore),
      avgKeywordCoverage: this.round(r.avgKeywordCoverage),
    }));
    return { points };
  }

  async crawlActivity(projectId: number, query: TrendsQueryDto) {
    const window = this.window(query);
    const rows = await this.repo.crawlActivity(projectId, window);
    const points = rows.map((r) => ({
      day: r.day,
      crawls: Number(r.crawls),
      pagesCrawled: r.pagesCrawled == null ? 0 : Number(r.pagesCrawled),
    }));
    return { points };
  }

  /**
   * ช่วงวันที่ — default 30 วันล่าสุด. date string → ขอบวัน UTC (from=00:00, to=23:59:59.999)
   * เพื่อให้ to เป็น inclusive ทั้งวัน. (Date.now/new Date ใช้ได้ใน service ปกติ).
   */
  private window(query: TrendsQueryDto): TrendWindow {
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
    const from = query.from
      ? new Date(`${query.from}T00:00:00.000Z`)
      : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    return { from, to };
  }

  /** DECIMAL string|null → number ปัดทศนิยม 1 ตำแหน่ง | null. */
  private round(value: string | null): number | null {
    if (value == null) return null;
    return Math.round(Number(value) * 10) / 10;
  }
}
