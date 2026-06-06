import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlHashOrNull } from '../common/url';
import { extractRowArray } from './rows';
import { AhrefsClient } from './ahrefs.client';
import { AhrefsRepo } from './ahrefs.repo';

/** payload ของ job 'enrich-organic' (queue 'ahrefs') — producer เตรียมให้ครบ. */
export interface EnrichOrganicJobData {
  projectId: number;
  domain: string;
  country: string;
  limit: number;
  cap: number; // เพดาน units/เดือน (resolve ตอน enqueue)
}

/** สรุปผล enrich — เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET status. */
export interface EnrichmentSummary {
  projectId: number;
  domain: string;
  fetched: number; // rows ที่ Ahrefs คืน
  keywordsUpserted: number;
  pageKeywordsInserted: number;
  unitsSpent: number;
  cached: boolean;
}

/**
 * field ที่ขอจาก Site Explorer organic-keywords (เอกสาร 03 §7 "select แคบ").
 * ชื่อตาม select ของ Ahrefs API v3 — ปรับจูนกับ response จริงได้ (รอบนี้ไม่ยิง live).
 */
const ORGANIC_FIELDS = [
  'keyword',
  'volume',
  'difficulty',
  'cpc',
  'traffic_potential',
  'position',
  'traffic',
  'traffic_value',
  'best_position_url',
];

const ORGANIC_ENDPOINT = 'site-explorer/organic-keywords';

/**
 * EnrichmentService — flow [2] slice แรก: ดึง organic-keywords ของ domain แล้ว
 * เขียนลง keywords (+ best-effort page_keywords). orchestrate ผ่าน AhrefsClient
 * (ผ่านงบ/cache/rate-limit ครบ). รันใน worker เท่านั้น (เอกสาร 00 §4).
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    private readonly ahrefs: AhrefsClient,
    private readonly repo: AhrefsRepo,
    private readonly config: ConfigService,
  ) {}

  async enrichOrganicKeywords(
    job: EnrichOrganicJobData,
  ): Promise<EnrichmentSummary> {
    const ttlSec =
      this.config.get<number>('AHREFS_ORGANIC_TTL_SEC') ?? 7 * 24 * 60 * 60;

    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: ORGANIC_ENDPOINT,
      params: { target: job.domain, country: job.country, limit: job.limit },
      fields: ORGANIC_FIELDS,
      expectedRows: job.limit,
      ttlSec,
      cap: job.cap,
    });

    const rows = extractRowArray(data);
    let keywordsUpserted = 0;
    let pageKeywordsInserted = 0;

    for (const row of rows) {
      const keyword = this.str(row.keyword);
      if (!keyword) continue; // ข้ามแถวที่ไม่มี keyword

      const keywordId = await this.repo.upsertKeyword({
        projectId: job.projectId,
        keyword,
        country: job.country,
        searchVolume: this.int(row.volume),
        difficulty: this.int(row.difficulty),
        cpc: this.num(row.cpc),
        trafficPotential: this.int(row.traffic_potential),
      });
      keywordsUpserted += 1;

      // best-effort: ผูก ranking กับหน้าที่ crawl มาแล้ว — hash ต้องคิดแบบเดียวกับ crawler
      // (sha1 ของ URL ที่ normalize แล้ว ผ่าน urlHashOrNull) มิฉะนั้น join ไม่ตรง; ไม่เจอก็ข้าม
      const rankingUrl = this.str(row.best_position_url) ?? this.str(row.url);
      const urlHash = urlHashOrNull(rankingUrl);
      if (urlHash) {
        const pageId = await this.repo.findPageByUrlHash(
          job.projectId,
          urlHash,
        );
        if (pageId != null) {
          await this.repo.insertPageKeyword({
            pageId,
            keywordId,
            position: this.int(row.position),
            traffic: this.int(row.traffic),
            trafficValue: this.num(row.traffic_value),
          });
          pageKeywordsInserted += 1;
        }
      }
    }

    const summary: EnrichmentSummary = {
      projectId: job.projectId,
      domain: job.domain,
      fetched: rows.length,
      keywordsUpserted,
      pageKeywordsInserted,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `enrich#${job.projectId} ${job.domain} → kw=${keywordsUpserted} pk=${pageKeywordsInserted} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  private num(v: unknown): number | null {
    if (v == null) return null;
    // string ว่าง/ช่องว่าง = "ไม่มีค่า" → null (กัน Number('')===0 ที่ทำให้ metric
    // ที่ Ahrefs ไม่ส่งมาถูกบันทึกเป็น 0 แล้วเพี้ยนตอนคัด top 20% by traffic).
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** จำนวนเต็มสำหรับคอลัมน์ int/smallint (ปัดเศษกัน float ลง smallint เพี้ยน). */
  private int(v: unknown): number | null {
    const n = this.num(v);
    return n == null ? null : Math.round(n);
  }

  private str(v: unknown): string | null {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }
}
