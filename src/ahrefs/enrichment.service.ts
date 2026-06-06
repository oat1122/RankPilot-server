import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlHashOrNull } from '../common/url';
import { extractRowArray } from './rows';
import { AhrefsClient } from './ahrefs.client';
import { AhrefsRepo } from './ahrefs.repo';
import { periodSnapshotDate } from './period';

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

/** payload ของ job 'enrich-keywords' (Keywords Explorer overview — เอกสาร 03a §4.1). */
export interface EnrichKeywordsJobData {
  projectId: number;
  country: string;
  keywords: string[]; // batch — กระจาย base 50 units ให้คุ้ม (เอกสาร 03 §7)
  cap: number;
}

/** สรุปผล keywords-explorer/overview (= job.returnvalue เมื่อ completed). */
export interface KeywordOverviewSummary {
  projectId: number;
  country: string;
  requested: number; // จำนวน keyword (unique) ที่ขอ
  fetched: number; // rows ที่ Ahrefs คืน
  keywordsUpserted: number;
  unitsSpent: number;
  cached: boolean;
}

/** payload ของ job 'top-pages' (Site Explorer top-pages — เอกสาร 03a §4.2). */
export interface TopPagesJobData {
  projectId: number;
  domain: string;
  country: string;
  limit: number;
  cap: number;
}

/** 1 หน้าใน top-pages selection (top 20% by traffic). */
export interface TopPage {
  url: string;
  traffic: number | null;
  topKeyword: string | null;
}

/** สรุปผล top-pages — คัด top 20% by traffic แล้วคืน selection (ป้อนต่อ per-page enrich). */
export interface TopPagesSummary {
  projectId: number;
  domain: string;
  fetched: number; // หน้าทั้งหมดที่ Ahrefs คืน
  topCount: number; // จำนวนหน้าที่คัด (top 20%)
  topPages: TopPage[];
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
  'parent_topic', // +1 unit/row — เก็บ keywords.parent_topic เลย ตัดเรียก Keywords Explorer ซ้ำ (เอกสาร 03a §3)
  'position',
  'traffic',
  'traffic_value',
  'best_position_url',
];

const ORGANIC_ENDPOINT = 'site-explorer/organic-keywords';

/**
 * Keywords Explorer overview (เอกสาร 03a §4.1) — enrich kw ที่ "ยังไม่ติด" แบบ batch,
 * map ลง keywords (intent เว้นให้ AI). traffic_potential (~10 units/row) ขอด้วย ∵ เป็น
 * สัญญาณ opportunity หลักของ kw ที่ยังไม่ติด — ปรับออกได้ถ้างบคับ (เอกสาร 03a §8).
 */
const OVERVIEW_FIELDS = [
  'keyword',
  'volume',
  'difficulty',
  'cpc',
  'traffic_potential',
  'parent_topic',
];
const OVERVIEW_ENDPOINT = 'keywords-explorer/overview';
const OVERVIEW_TTL_DEFAULT_SEC = 30 * 24 * 60 * 60; // metric เปลี่ยนช้า (เอกสาร 03 §3 = 30 วัน)

/**
 * Site Explorer top-pages (เอกสาร 03a §4.2) — คัดหน้าคุ้ม-enrich ก่อนยิง organic-keywords
 * ราย URL. select แคบ (url/traffic/top_keyword); คัด top 20% by traffic (เอกสาร 00 §4.2).
 */
const TOPPAGES_FIELDS = ['url', 'traffic', 'top_keyword'];
const TOPPAGES_ENDPOINT = 'site-explorer/top-pages';
const TOPPAGES_TTL_DEFAULT_SEC = 7 * 24 * 60 * 60;
/** สัดส่วนหน้าที่คัดไป enrich ต่อ = top 20% by traffic (เอกสาร 00 §4.2 / 03 §7). */
const TOP_TRAFFIC_FRACTION = 0.2;

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
      params: {
        target: job.domain,
        country: job.country,
        limit: job.limit,
        // date เป็น required ของ organic-keywords (เอกสาร 03a §3); pin กับ period ให้ cache
        // key นิ่งทั้งเดือน (ไม่ bust รายวัน) — ความถี่ refresh จริงคุมด้วย ttlSec.
        date: periodSnapshotDate(),
        // เพดาน Lite ~10 rows/req → เอา keyword ทราฟฟิกสูงก่อน (กฎ top 20% by traffic,
        // เอกสาร 03 §7 / 03a §3). traffic อยู่ใน select แล้ว → ไม่เพิ่ม units.
        order_by: 'traffic:desc',
      },
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
        parentTopic: this.str(row.parent_topic), // intent ยังเว้นให้ AI ตั้ง (เอกสาร 02)
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

  /**
   * enrichKeywordOverview (เอกสาร 03a §4.1) — batch enrich keyword ที่ "ยังไม่ติด" ผ่าน
   * Keywords Explorer overview แล้ว upsert ลง keywords. ไม่แตะ page_keywords (ไม่ใช่ ranking
   * ของหน้า). keyword ถูก dedup + sort ก่อน → cache key นิ่งไม่ขึ้นกับลำดับ/ตัวซ้ำที่ส่งมา.
   */
  async enrichKeywordOverview(
    job: EnrichKeywordsJobData,
  ): Promise<KeywordOverviewSummary> {
    const ttlSec =
      this.config.get<number>('AHREFS_KEYWORDS_TTL_SEC') ??
      OVERVIEW_TTL_DEFAULT_SEC;

    const keywords = this.uniqueKeywords(job.keywords);
    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: OVERVIEW_ENDPOINT,
      params: {
        keywords: keywords.join(','),
        country: job.country,
        date: periodSnapshotDate(),
      },
      fields: OVERVIEW_FIELDS,
      expectedRows: keywords.length,
      ttlSec,
      cap: job.cap,
    });

    const rows = extractRowArray(data);
    let keywordsUpserted = 0;
    for (const row of rows) {
      const keyword = this.str(row.keyword);
      if (!keyword) continue; // ข้ามแถวที่ไม่มี keyword
      await this.repo.upsertKeyword({
        projectId: job.projectId,
        keyword,
        country: job.country,
        searchVolume: this.int(row.volume),
        difficulty: this.int(row.difficulty),
        cpc: this.num(row.cpc),
        trafficPotential: this.int(row.traffic_potential),
        parentTopic: this.str(row.parent_topic),
      });
      keywordsUpserted += 1;
    }

    const summary: KeywordOverviewSummary = {
      projectId: job.projectId,
      country: job.country,
      requested: keywords.length,
      fetched: rows.length,
      keywordsUpserted,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `kw-overview#${job.projectId} req=${keywords.length} → kw=${keywordsUpserted} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /**
   * selectTopPages (เอกสาร 03a §4.2) — ดึง top-pages ของ domain แล้วคัด top 20% by traffic
   * (เอกสาร 00 §4.2) คืนเป็น selection ให้ขั้นถัดไป (per-page organic-keywords) — ลดจำนวน
   * call/units. ไม่เขียน DB (เป็นขั้น "เลือกหน้า" ไม่ใช่ "เก็บผล"); งบ/cache/usage นับผ่าน client.
   */
  async selectTopPages(job: TopPagesJobData): Promise<TopPagesSummary> {
    const ttlSec =
      this.config.get<number>('AHREFS_TOPPAGES_TTL_SEC') ??
      TOPPAGES_TTL_DEFAULT_SEC;

    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: TOPPAGES_ENDPOINT,
      params: {
        target: job.domain,
        country: job.country,
        limit: job.limit,
        date: periodSnapshotDate(),
        order_by: 'traffic:desc',
      },
      fields: TOPPAGES_FIELDS,
      expectedRows: job.limit,
      ttlSec,
      cap: job.cap,
    });

    const pages = extractRowArray(data)
      .map((row) => ({
        url: this.str(row.url),
        traffic: this.int(row.traffic),
        topKeyword: this.str(row.top_keyword),
      }))
      .filter((p): p is TopPage => p.url !== null); // ทิ้งแถวที่ไม่มี url

    // คัด top 20% by traffic (อย่างน้อย 1 หน้าถ้ามีข้อมูล); traffic null = ท้ายแถว
    const sorted = [...pages].sort(
      (a, b) => (b.traffic ?? -1) - (a.traffic ?? -1),
    );
    const topCount = pages.length
      ? Math.max(1, Math.ceil(pages.length * TOP_TRAFFIC_FRACTION))
      : 0;
    const topPages = sorted.slice(0, topCount);

    const summary: TopPagesSummary = {
      projectId: job.projectId,
      domain: job.domain,
      fetched: pages.length,
      topCount,
      topPages,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `top-pages#${job.projectId} ${job.domain} → top ${topCount}/${pages.length} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /** dedup + trim + sort keyword (cache key นิ่งไม่ขึ้นกับลำดับ/ตัวซ้ำ; ทิ้งตัวว่าง). */
  private uniqueKeywords(list: string[]): string[] {
    const set = new Set<string>();
    for (const k of list) {
      const t = typeof k === 'string' ? k.trim() : '';
      if (t) set.add(t);
    }
    return [...set].sort();
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
