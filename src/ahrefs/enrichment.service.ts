import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlHashOrNull } from '../common/url';
import { extractRowArray } from './client/rows';
import { AhrefsClient } from './client/ahrefs.client';
import { AhrefsRepo } from './ahrefs.repo';
import type { InsertSerpResultInput } from './ahrefs.repo';
import { periodSnapshotDate } from './budget/period';

/** payload ของ job 'enrich-organic' (queue 'ahrefs') — producer เตรียมให้ครบ. */
export interface EnrichOrganicJobData {
  projectId: number;
  domain: string;
  country: string;
  limit: number;
  cap: number; // เพดาน units/เดือน (resolve ตอน enqueue)
  target?: string; // เป้าเฉพาะ URL (orchestration top-pages → exact); default = domain
  mode?: string; // organic-keywords mode: exact|prefix|domain|subdomains (เอกสาร 03a §3)
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
  enrichSelected?: boolean; // true = worker fan-out per-page organic (mode=exact) ต่อ
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

/** payload ของ job 'competitors' (organic-competitors — เอกสาร 03a §4.3). */
export interface CompetitorsJobData {
  projectId: number;
  domain: string;
  country: string;
  limit: number;
  cap: number;
}

/** สรุปผล organic-competitors — upsert competitors (ป้อน content-gap เอกสาร 02). */
export interface CompetitorsSummary {
  projectId: number;
  domain: string;
  fetched: number;
  competitorsUpserted: number;
  unitsSpent: number;
  cached: boolean;
}

/** payload ของ job 'serp-overview' (SERP top N ของ 1 keyword — เอกสาร 03a §5). */
export interface SerpOverviewJobData {
  projectId: number;
  keyword: string;
  country: string;
  limit: number;
  cap: number;
}

/** สรุปผล serp-overview — insert serp_results (snapshot ต่อ keyword). */
export interface SerpOverviewSummary {
  projectId: number;
  keyword: string;
  fetched: number;
  serpInserted: number;
  unitsSpent: number;
  cached: boolean;
}

/** matching = "มีคำนี้อยู่", related = "ใกล้เคียง" (query fan-out) — เอกสาร 03a §5. */
export type KeywordIdeasMode = 'matching' | 'related';

/** payload ของ job 'keyword-ideas' (matching/related-terms — เอกสาร 03a §5). */
export interface KeywordIdeasJobData {
  projectId: number;
  seed: string;
  country: string;
  limit: number;
  cap: number;
  mode: KeywordIdeasMode;
}

/** สรุปผล keyword ideas — insert content_gaps (seed ideas). */
export interface KeywordIdeasSummary {
  projectId: number;
  seed: string;
  mode: KeywordIdeasMode;
  fetched: number;
  gapsInserted: number;
  unitsSpent: number;
  cached: boolean;
}

/** payload ของ job 'backlinks' (site-explorer metrics/DR/refdomains — เอกสาร 03a §6). */
export interface BacklinksJobData {
  projectId: number;
  domain: string;
  country: string;
  cap: number;
  // target = URL เฉพาะหน้า (ระดับ URL, backlinks-stats mode=exact) ถ้าส่งมา; ไม่ส่ง = ระดับ domain.
  target?: string;
  // pageId ของ backlink_snapshots (page-scoped) — null/undefined = ระดับ domain.
  pageId?: number | null;
}

/** สรุปผล backlinks — insert backlink_snapshots (DR/UR/refdomains/backlinks ระดับ domain/URL). */
export interface BacklinksSummary {
  projectId: number;
  domain: string;
  domainRating: number | null;
  urlRating: number | null;
  referringDomains: number | null;
  backlinks: number | null; // BL = total live backlinks (backlinks-stats → metrics.live)
  unitsSpent: number;
  cached: boolean;
}

/** ผล refdomains-history (LW: ref domains ใหม่/หาย) — flag-gated; null = ดึงไม่ได้/ปิด. */
export interface RefdomainsHistoryResult {
  refdomainsNew: number | null;
  refdomainsLost: number | null;
  unitsSpent: number;
  cached: boolean;
}

/** ผลประมาณการ spam (SS) จาก DR distribution ของ refdomains — flag-gated; null = ปิด/ดึงไม่ได้. */
export interface SpamEstimateResult {
  spamScore: number | null; // % ของ refdomains ที่ DR ต่ำ (≤ SPAM_DR_THRESHOLD)
  unitsSpent: number;
  cached: boolean;
}

/** payload ของ job 'page-enrich' — วิเคราะห์เชิงลึกรายหน้า (orchestrate Ahrefs ระดับ URL). */
export interface PageEnrichJobData {
  projectId: number;
  pageId: number;
  url: string; // target ระดับ exact ของหน้านี้
  domain: string;
  country: string;
  cap: number;
  limit: number; // จำนวน organic-keywords ราย URL (mode=exact)
}

/** สรุปผล page-enrich — รวม 3 ขั้น (organic exact + backlinks ราย URL + serp primary kw). */
export interface PageEnrichSummary {
  projectId: number;
  pageId: number;
  url: string;
  organicFetched: number;
  pageKeywordsInserted: number;
  domainRating: number | null;
  urlRating: number | null;
  referringDomains: number | null;
  primaryKeyword: string | null;
  serpInserted: number;
  unitsSpent: number;
  cached: boolean;
}

/** payload ของ job 'site-enrich' — ดึง Ahrefs ระดับโดเมน (ปุ่ม on-demand บน dashboard). */
export interface SiteEnrichJobData {
  projectId: number;
  domain: string;
  country: string;
  cap: number;
  competitorsLimit: number;
}

/** สรุปผล site-enrich — รวม backlinks (domain DR/refdomains) + competitors. */
export interface SiteEnrichSummary {
  projectId: number;
  domain: string;
  domainRating: number | null;
  referringDomains: number | null;
  competitorsUpserted: number;
  unitsSpent: number;
  cached: boolean;
}

/**
 * field ที่ขอจาก Site Explorer organic-keywords (เอกสาร 03 §7 "select แคบ").
 * ชื่อตาม select ของ Ahrefs API v3 — ปรับจูนกับ response จริงได้ (รอบนี้ไม่ยิง live).
 */
// ชื่อ column ยืนยันกับ Ahrefs v3 docs (site-explorer/organic-keywords, 2026-06-09):
// KD = keyword_difficulty, อันดับ = best_position, ทราฟฟิกรวมต่อหน้า = sum_traffic.
// traffic_potential/parent_topic ไม่มีใน endpoint นี้ (มีเฉพาะ Keywords Explorer overview) และ
// traffic_value ไม่ใช่ column ที่ถูกต้อง → ตัดออก กัน Ahrefs ตอบ 400 (Unknown column).
const ORGANIC_FIELDS = [
  'keyword',
  'volume',
  'keyword_difficulty',
  'cpc',
  'best_position',
  'sum_traffic',
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
const TOPPAGES_FIELDS = ['url', 'sum_traffic', 'top_keyword'];
const TOPPAGES_ENDPOINT = 'site-explorer/top-pages';
const TOPPAGES_TTL_DEFAULT_SEC = 7 * 24 * 60 * 60;
/** สัดส่วนหน้าที่คัดไป enrich ต่อ = top 20% by traffic (เอกสาร 00 §4.2 / 03 §7). */
const TOP_TRAFFIC_FRACTION = 0.2;

/**
 * Endpoint Tier 2-4 ที่เหลือ (เอกสาร 03a §4.3/§5/§6) — select แคบตาม cost, ปลายทาง DB
 * ตามเอกสาร 03a §9. TTL เป็น const (ไม่ผ่าน env — เลี่ยง sprawl; promote เป็น env ภายหลังได้).
 */
const COMPETITORS_ENDPOINT = 'site-explorer/organic-competitors';
// keywords_common = จำนวน keyword ที่ทับกับ target (Ahrefs v3 column จริง — ไม่ใช่ common_keywords).
const COMPETITORS_FIELDS = ['competitor_domain', 'keywords_common'];
const COMPETITORS_TTL_SEC = 7 * 24 * 60 * 60;

const SERP_ENDPOINT = 'serp-overview';
// serp-overview ไม่มี column `domain` → ขอแค่ position/url แล้ว derive domain จาก url (hostOf).
const SERP_FIELDS = ['position', 'url'];
const SERP_TTL_SEC = 7 * 24 * 60 * 60; // SERP overview ~7 วัน (เอกสาร 03 §3)
/** จำนวน SERP rows ที่ดึงตอน page-enrich (top 10 คู่แข่ง — พอสำหรับการ์ด SERP บน page detail). */
const PAGE_SERP_LIMIT = 10;

const IDEAS_ENDPOINT_MATCHING = 'keywords-explorer/matching-terms';
const IDEAS_ENDPOINT_RELATED = 'keywords-explorer/related-terms';
const IDEAS_FIELDS = ['keyword', 'volume'];
const IDEAS_TTL_SEC = 30 * 24 * 60 * 60;

// DR/refdomains ไม่ได้อยู่ใน endpoint เดียว: site-explorer/metrics คืน org_traffic/org_keywords
// (ไม่ใช่ DR) และไม่รับ select. ของจริง (Ahrefs v3):
//   - domain-rating  → { domain_rating: { domain_rating, ahrefs_rank } }   (fixed object, ไม่มี select)
//   - backlinks-stats → { metrics: { live, live_refdomains, all_time, ... } } (fixed object, ไม่มี select)
// UR (url_rating) ไม่มี endpoint ตรง ๆ ใน flow นี้ → เก็บเป็น null.
const DOMAIN_RATING_ENDPOINT = 'site-explorer/domain-rating';
const BACKLINKS_STATS_ENDPOINT = 'site-explorer/backlinks-stats';
const BACKLINKS_TTL_SEC = 30 * 24 * 60 * 60; // backlinks summary ~30 วัน (เอกสาร 03 §3)

// รายงานเว็บเต็ม (apnth.com template) — endpoint เสริมที่ flag-gated (อาจไม่อยู่ใน plan Lite).
// refdomains-history (LW) คืน list ราย period { date, new, lost }; refdomains (SS) คืน DR ราย
// referring domain. ชื่อ column อาจต้องจูนกับ response จริง (client surface error body — memory).
const REFDOMAINS_HISTORY_ENDPOINT = 'site-explorer/refdomains-history';
const REFDOMAINS_HISTORY_FIELDS = ['date', 'new', 'lost'];
const REFDOMAINS_ENDPOINT = 'site-explorer/refdomains';
const REFDOMAINS_FIELDS = ['domain', 'domain_rating'];
/** จำนวน refdomains ที่ sample มาคำนวณ spam (DR ต่ำสุดก่อน) — คุม units. */
const SPAM_SAMPLE_LIMIT = 100;
/** refdomain ที่ DR ≤ ค่านี้ นับเป็น "คุณภาพต่ำ" สำหรับประมาณการ spam. */
const SPAM_DR_THRESHOLD = 5;

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
    // target = URL เฉพาะ (orchestration mode=exact) ถ้าส่งมา ไม่งั้น = ทั้ง domain.
    const target = job.target ?? job.domain;

    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: ORGANIC_ENDPOINT,
      params: {
        target,
        country: job.country,
        limit: job.limit,
        // ใส่ mode เฉพาะเมื่อระบุ (เช่น 'exact' ตอน enrich ราย URL) — ไม่ระบุ = default ของ
        // Ahrefs (subdomains). conditional เพื่อไม่เปลี่ยน cache key ของงาน domain เดิม.
        ...(job.mode ? { mode: job.mode } : {}),
        // date เป็น required ของ organic-keywords (เอกสาร 03a §3); pin กับ period ให้ cache
        // key นิ่งทั้งเดือน (ไม่ bust รายวัน) — ความถี่ refresh จริงคุมด้วย ttlSec.
        date: periodSnapshotDate(),
        // เพดาน Lite ~10 rows/req → เอา keyword ทราฟฟิกสูงก่อน (กฎ top 20% by traffic,
        // เอกสาร 03 §7 / 03a §3). sum_traffic อยู่ใน select แล้ว → ไม่เพิ่ม units.
        order_by: 'sum_traffic:desc',
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
        difficulty: this.int(row.keyword_difficulty),
        cpc: this.num(row.cpc),
        // organic-keywords ไม่คืน traffic_potential/parent_topic (มีเฉพาะ Keywords Explorer
        // overview) → ไม่ส่ง = upsertKeyword ข้าม field ที่ undefined ไม่ทับค่าที่ overview
        // เคย enrich ไว้. intent ก็ยังเว้นให้ AI ตั้ง (เอกสาร 02).
      });
      keywordsUpserted += 1;

      // best-effort: ผูก ranking กับหน้าที่ crawl มาแล้ว — hash ต้องคิดแบบเดียวกับ crawler
      // (sha1 ของ URL ที่ normalize แล้ว ผ่าน urlHashOrNull) มิฉะนั้น join ไม่ตรง; ไม่เจอก็ข้าม
      const rankingUrl = this.str(row.best_position_url);
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
            position: this.int(row.best_position),
            traffic: this.int(row.sum_traffic),
            // organic-keywords ไม่มี traffic_value → ปล่อย trafficValue เป็น null
          });
          pageKeywordsInserted += 1;
        }
      }
    }

    const summary: EnrichmentSummary = {
      projectId: job.projectId,
      domain: target, // = URL เมื่อ enrich ราย URL (mode=exact), ไม่งั้น = domain
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
        // Keywords Explorer ไม่มี param `date` (ต่างจาก Site Explorer) → ส่งไปเสี่ยง 400.
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
        order_by: 'sum_traffic:desc',
      },
      fields: TOPPAGES_FIELDS,
      expectedRows: job.limit,
      ttlSec,
      cap: job.cap,
    });

    const pages = extractRowArray(data)
      .map((row) => ({
        url: this.str(row.url),
        traffic: this.int(row.sum_traffic), // ทราฟฟิกรวมต่อหน้า (Ahrefs v3 column)
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

  /**
   * enrichCompetitors (เอกสาร 03a §4.3) — ดึงคู่แข่ง organic ของ domain แล้ว upsert ลง
   * competitors (uq_comp = no-op ถ้าซ้ำ). ป้อน content-gap analysis (เอกสาร 02).
   */
  async enrichCompetitors(
    job: CompetitorsJobData,
  ): Promise<CompetitorsSummary> {
    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: COMPETITORS_ENDPOINT,
      params: {
        target: job.domain,
        country: job.country,
        limit: job.limit,
        date: periodSnapshotDate(),
        order_by: 'keywords_common:desc', // คู่แข่งที่ทับ keyword มากสุดก่อน
      },
      fields: COMPETITORS_FIELDS,
      expectedRows: job.limit,
      ttlSec: COMPETITORS_TTL_SEC,
      cap: job.cap,
    });

    const rows = extractRowArray(data);
    let competitorsUpserted = 0;
    for (const row of rows) {
      const domain = this.str(row.competitor_domain);
      if (!domain) continue;
      await this.repo.upsertCompetitor(job.projectId, domain);
      competitorsUpserted += 1;
    }

    const summary: CompetitorsSummary = {
      projectId: job.projectId,
      domain: job.domain,
      fetched: rows.length,
      competitorsUpserted,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `competitors#${job.projectId} ${job.domain} → ${competitorsUpserted}/${rows.length} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /**
   * fetchSerpOverview (เอกสาร 03a §5) — SERP top N ของ 1 keyword. upsert keyword ก่อนเพื่อ
   * ได้ keywordId (FK ของ serp_results) แล้ว insert SERP rows เป็น snapshot (time-series).
   */
  async fetchSerpOverview(
    job: SerpOverviewJobData,
  ): Promise<SerpOverviewSummary> {
    // ต้องมี keywordId ก่อน (serp_results.keyword_id required) — upsert แบบ metric ว่าง
    const keywordId = await this.repo.upsertKeyword({
      projectId: job.projectId,
      keyword: job.keyword,
      country: job.country,
    });

    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: SERP_ENDPOINT,
      params: {
        keyword: job.keyword,
        country: job.country,
        // serp-overview ใช้ `top_positions` (ไม่ใช่ limit) และ date เป็น datetime optional →
        // ไม่ส่ง date (ใช้ snapshot ล่าสุดที่มี) กัน format YYYY-MM-01 ไม่ตรงแล้ว 400.
        top_positions: job.limit,
      },
      fields: SERP_FIELDS,
      expectedRows: job.limit,
      ttlSec: SERP_TTL_SEC,
      cap: job.cap,
    });

    const serp: InsertSerpResultInput[] = [];
    for (const row of extractRowArray(data)) {
      const position = this.int(row.position);
      const url = this.str(row.url);
      const domain = this.str(row.domain) ?? (url ? this.hostOf(url) : null);
      if (position == null || !url || !domain) continue; // 3 คอลัมน์ required
      serp.push({ keywordId, position, url, domain });
    }
    await this.repo.insertSerpResults(serp);

    const summary: SerpOverviewSummary = {
      projectId: job.projectId,
      keyword: job.keyword,
      fetched: extractRowArray(data).length,
      serpInserted: serp.length,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `serp#${job.projectId} "${job.keyword}" → ${serp.length} rows units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /**
   * fetchKeywordIdeas (เอกสาร 03a §5) — matching/related-terms ของ seed keyword → เก็บเป็น
   * content_gaps (seed ideas / query fan-out). rows เยอะ → จำกัดด้วย limit + order_by volume.
   */
  async fetchKeywordIdeas(
    job: KeywordIdeasJobData,
  ): Promise<KeywordIdeasSummary> {
    const endpoint =
      job.mode === 'related' ? IDEAS_ENDPOINT_RELATED : IDEAS_ENDPOINT_MATCHING;

    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint,
      params: {
        keywords: job.seed,
        country: job.country,
        limit: job.limit,
        // matching/related-terms = Keywords Explorer → ไม่มี param `date` (ส่งไปเสี่ยง 400).
        order_by: 'volume:desc',
      },
      fields: IDEAS_FIELDS,
      expectedRows: job.limit,
      ttlSec: IDEAS_TTL_SEC,
      cap: job.cap,
    });

    const rows = extractRowArray(data);
    let gapsInserted = 0;
    for (const row of rows) {
      const idea = this.str(row.keyword);
      if (!idea) continue;
      await this.repo.insertContentGap({
        projectId: job.projectId,
        missingSubtopic: idea,
      });
      gapsInserted += 1;
    }

    const summary: KeywordIdeasSummary = {
      projectId: job.projectId,
      seed: job.seed,
      mode: job.mode,
      fetched: rows.length,
      gapsInserted,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `ideas#${job.projectId} ${job.mode} "${job.seed}" → ${gapsInserted}/${rows.length} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /**
   * fetchBacklinks (เอกสาร 03a §6) — DR/UR/refdomains ระดับ domain → backlink_snapshots
   * (บริบท "หน้า rank ไหวไหม"). response เป็นค่าเดี่ยว (ไม่ใช่ list) → extractMetricsRow.
   */
  async fetchBacklinks(job: BacklinksJobData): Promise<BacklinksSummary> {
    // target ระดับ URL (mode=exact) ถ้าส่งมา ไม่งั้น = ทั้ง domain. DR เป็น metric ระดับ domain
    // เสมอ (Ahrefs ไม่มี DR ราย URL) → ยิงด้วย domain; UR/refdomains ดึงตาม target ได้.
    const target = job.target ?? job.domain;
    const isUrlTarget = job.target != null && job.target !== job.domain;

    // DR (Domain Rating) — site-explorer/domain-rating: fixed object ไม่มี select/country.
    const dr = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: DOMAIN_RATING_ENDPOINT,
      params: { target: job.domain, date: periodSnapshotDate() },
      fields: [],
      expectedRows: 1,
      ttlSec: BACKLINKS_TTL_SEC,
      cap: job.cap,
    });
    // refdomains/UR — site-explorer/backlinks-stats: fixed object ไม่มี select/country.
    // ราย URL ใส่ mode=exact (นับ backlinks ที่ชี้มาที่ URL นี้เท่านั้น ไม่ใช่ทั้งโดเมน).
    const bl = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: BACKLINKS_STATS_ENDPOINT,
      params: {
        target,
        date: periodSnapshotDate(),
        ...(isUrlTarget ? { mode: 'exact' } : {}),
      },
      fields: [],
      expectedRows: 1,
      ttlSec: BACKLINKS_TTL_SEC,
      cap: job.cap,
    });

    // response เป็น nested object: { domain_rating: { domain_rating } } และ
    // { metrics: { live_refdomains, url_rating? } }. UR มีเฉพาะตอน target เป็น URL (ราย URL).
    const domainRating = this.int(
      this.nested(dr.data, 'domain_rating', 'domain_rating'),
    );
    const referringDomains = this.int(
      this.nested(bl.data, 'metrics', 'live_refdomains'),
    );
    const urlRating = this.int(this.nested(bl.data, 'metrics', 'url_rating'));
    // BL = total live backlinks (backlinks-stats → metrics.live) — รายงานเว็บเต็ม (apnth.com template).
    const backlinks = this.int(this.nested(bl.data, 'metrics', 'live'));
    await this.repo.insertBacklinkSnapshot({
      projectId: job.projectId,
      pageId: job.pageId ?? null, // page-scoped เมื่อ enrich ราย URL ไม่งั้น = domain-level
      domainRating,
      urlRating,
      referringDomains,
      backlinks,
    });

    const unitsSpent = dr.unitsSpent + bl.unitsSpent;
    const cached = dr.cached && bl.cached;
    const summary: BacklinksSummary = {
      projectId: job.projectId,
      domain: target, // = URL เมื่อ enrich ราย URL, ไม่งั้น = domain
      domainRating,
      urlRating,
      referringDomains,
      backlinks,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `backlinks#${job.projectId} ${target} → DR=${domainRating} UR=${urlRating} BL=${backlinks} refdom=${referringDomains} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /**
   * refdomains-history (LW: ref domains ใหม่/หาย — เอกสาร 03a §6, Tier สูง). flag-gated โดย caller
   * (SiteReportRunner) ∵ อาจไม่อยู่ใน plan Lite. ยิงผ่านงบ/cache ครบ. response เป็น list ราย
   * เดือน { date, new, lost } → เอาแถวล่าสุด (new/lost ของช่วงล่าสุด). best-effort: error โยนกลับให้
   * caller จับ (degrade เป็น null) — ไม่เขียน DB ที่นี่ (runner รวมลง site_reports).
   */
  async fetchRefdomainsHistory(
    job: SiteEnrichJobData,
  ): Promise<RefdomainsHistoryResult> {
    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: REFDOMAINS_HISTORY_ENDPOINT,
      params: {
        target: job.domain,
        date: periodSnapshotDate(),
        history_grouping: 'monthly',
      },
      fields: REFDOMAINS_HISTORY_FIELDS,
      expectedRows: 12,
      ttlSec: BACKLINKS_TTL_SEC,
      cap: job.cap,
    });
    const rows = extractRowArray(data);
    const last = rows[rows.length - 1] ?? {};
    return {
      refdomainsNew: this.int(last.new ?? last.refdomains_new),
      refdomainsLost: this.int(last.lost ?? last.refdomains_lost),
      unitsSpent,
      cached,
    };
  }

  /**
   * SpamScore (SS) ประมาณการ — ไม่ใช่ metric Ahrefs. ยิง site-explorer/refdomains (DR ราย
   * referring domain) แล้วคำนวณ % ของ refdomains ที่ DR ต่ำ (≤ SPAM_DR_THRESHOLD) = สัญญาณ
   * link คุณภาพต่ำ. flag-gated โดย caller. best-effort: error โยนกลับให้ caller จับ (degrade null).
   */
  async fetchSpamEstimate(job: SiteEnrichJobData): Promise<SpamEstimateResult> {
    const { data, unitsSpent, cached } = await this.ahrefs.fetch({
      projectId: job.projectId,
      endpoint: REFDOMAINS_ENDPOINT,
      params: {
        target: job.domain,
        date: periodSnapshotDate(),
        order_by: 'domain_rating:asc',
      },
      fields: REFDOMAINS_FIELDS,
      expectedRows: SPAM_SAMPLE_LIMIT,
      ttlSec: BACKLINKS_TTL_SEC,
      cap: job.cap,
    });
    const rows = extractRowArray(data);
    if (rows.length === 0) return { spamScore: null, unitsSpent, cached };
    const low = rows.filter(
      (r) => (this.int(r.domain_rating) ?? 0) <= SPAM_DR_THRESHOLD,
    ).length;
    const spamScore = Math.round((low / rows.length) * 100);
    return { spamScore, unitsSpent, cached };
  }

  /**
   * enrichPage — วิเคราะห์เชิงลึก "รายหน้า" (ปุ่ม on-demand บน page detail). orchestrate Ahrefs
   * ระดับ URL ตามลำดับ (แต่ละ call ผ่านงบ/cache/rate ครบ):
   *   1) organic-keywords (target=url, mode=exact) → page_keywords ของ URL นี้
   *   2) backlinks (target=url, pageId) → backlink_snapshots ราย URL (UR/refdomains) + DR (domain)
   *   3) primary keyword (top by traffic) → serp-overview → serp_results (คู่แข่งบน SERP)
   * คืน summary รวม unitsSpent/cached ให้ api อ่านผ่าน GET enrich/:jobId.
   */
  async enrichPage(job: PageEnrichJobData): Promise<PageEnrichSummary> {
    // 1) organic ราย URL (mode=exact) — ranking + per-keyword traffic/value ของหน้านี้
    const organic = await this.enrichOrganicKeywords({
      projectId: job.projectId,
      domain: job.domain,
      country: job.country,
      limit: job.limit,
      cap: job.cap,
      target: job.url,
      mode: 'exact',
    });

    // 2) backlinks ราย URL — เขียน backlink_snapshots(pageId) (UR/refdomains) + DR ระดับ domain
    const backlinks = await this.fetchBacklinks({
      projectId: job.projectId,
      domain: job.domain,
      country: job.country,
      cap: job.cap,
      target: job.url,
      pageId: job.pageId,
    });

    // 3) SERP ของ primary keyword (ทราฟฟิกมากสุดของหน้านี้) → คู่แข่งบน SERP
    const primaryKeyword = await this.repo.getPrimaryKeyword(job.pageId);
    let serpInserted = 0;
    let serpUnits = 0;
    let serpCached = true;
    if (primaryKeyword) {
      const serp = await this.fetchSerpOverview({
        projectId: job.projectId,
        keyword: primaryKeyword,
        country: job.country,
        limit: PAGE_SERP_LIMIT,
        cap: job.cap,
      });
      serpInserted = serp.serpInserted;
      serpUnits = serp.unitsSpent;
      serpCached = serp.cached;
    }

    const unitsSpent = organic.unitsSpent + backlinks.unitsSpent + serpUnits;
    const cached = organic.cached && backlinks.cached && serpCached;
    const summary: PageEnrichSummary = {
      projectId: job.projectId,
      pageId: job.pageId,
      url: job.url,
      organicFetched: organic.fetched,
      pageKeywordsInserted: organic.pageKeywordsInserted,
      domainRating: backlinks.domainRating,
      urlRating: backlinks.urlRating,
      referringDomains: backlinks.referringDomains,
      primaryKeyword,
      serpInserted,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `page-enrich#${job.projectId} page=${job.pageId} ${job.url} → org=${organic.fetched} pk=${organic.pageKeywordsInserted} DR=${backlinks.domainRating} UR=${backlinks.urlRating} refdom=${backlinks.referringDomains} serp=${serpInserted} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /**
   * enrichSite — ดึง Ahrefs ระดับโดเมน (ปุ่ม "ดึงข้อมูลเว็บ" บน dashboard). orchestrate
   * 2 ขั้น (แต่ละ call ผ่านงบ/cache/rate ครบ):
   *   1) backlinks (domain) → backlink_snapshots (pageId null) = DR/refdomains ระดับโดเมน
   *   2) competitors (domain) → competitors (คู่แข่ง organic)
   * organic ของเว็บ (traffic/keywords) มาจาก auto-chain เดิม (enrich-organic) ไม่ทำซ้ำที่นี่.
   */
  async enrichSite(job: SiteEnrichJobData): Promise<SiteEnrichSummary> {
    const backlinks = await this.fetchBacklinks({
      projectId: job.projectId,
      domain: job.domain,
      country: job.country,
      cap: job.cap,
    });
    const competitors = await this.enrichCompetitors({
      projectId: job.projectId,
      domain: job.domain,
      country: job.country,
      limit: job.competitorsLimit,
      cap: job.cap,
    });

    const unitsSpent = backlinks.unitsSpent + competitors.unitsSpent;
    const cached = backlinks.cached && competitors.cached;
    const summary: SiteEnrichSummary = {
      projectId: job.projectId,
      domain: job.domain,
      domainRating: backlinks.domainRating,
      referringDomains: backlinks.referringDomains,
      competitorsUpserted: competitors.competitorsUpserted,
      unitsSpent,
      cached,
    };
    this.logger.log(
      `site-enrich#${job.projectId} ${job.domain} → DR=${backlinks.domainRating} refdom=${backlinks.referringDomains} comp=${competitors.competitorsUpserted} units=${unitsSpent} cached=${cached}`,
    );
    return summary;
  }

  /** hostname จาก URL (เติม serp_results.domain เมื่อ Ahrefs ไม่ส่ง domain มาตรง ๆ). */
  private hostOf(url: string): string | null {
    try {
      return new URL(url).hostname || null;
    } catch {
      return null;
    }
  }

  /**
   * อ่านค่าใน object ซ้อนตาม path (เช่น nested(data,'domain_rating','domain_rating')) — ใช้กับ
   * response แบบ fixed-object ของ domain-rating/backlinks-stats. undefined ถ้า path ไม่ครบ.
   */
  private nested(data: unknown, ...path: string[]): unknown {
    let cur: unknown = data;
    for (const key of path) {
      if (cur && typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return cur;
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
