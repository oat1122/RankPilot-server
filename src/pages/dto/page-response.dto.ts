import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response ของ GET /projects/:projectId/pages/:pageId — รวมทุกอย่างของหน้าเดียวไว้ที่เดียว
 * (on-page snapshot + score + ranking จาก Ahrefs + links + images + findings) เพื่อหน้า page detail.
 * recommendations ไม่รวม (FE ใช้ GET /ai/recommendations?pageId= เดิม). field json = unknown (เอกสาร 04 §6).
 */
export const pageRankingSchema = z.object({
  keyword: z.string(),
  position: z.number().nullable(),
  traffic: z.number().nullable(),
  trafficValue: z.number().nullable(),
  // metric ของ keyword (join keywords) — เติมจาก Ahrefs enrich; null ถ้ายังไม่ enrich
  difficulty: z.number().nullable(), // KD 0-100
  searchVolume: z.number().nullable(),
  cpc: z.number().nullable(),
  intent: z.string().nullable(),
});

/** Page Authority/Backlinks — DR/UR/refdomains (page-level ก่อน, fallback domain) + organic summary. */
export const pageBacklinksSchema = z.object({
  scope: z.enum(['page', 'domain']).nullable(), // ที่มาของ DR/UR/refdomains
  domainRating: z.number().nullable(),
  urlRating: z.number().nullable(),
  referringDomains: z.number().nullable(),
  orgTraffic: z.number().nullable(),
  orgValue: z.number().nullable(),
  orgKeywords: z.number().nullable(),
  capturedAt: z.coerce.string().nullable(),
});

/** 1 แถว SERP คู่แข่งของ primary keyword (isOwn = หน้าของเราเอง). */
export const pageSerpRowSchema = z.object({
  position: z.number(),
  url: z.string(),
  domain: z.string(),
  isOwn: z.boolean(),
});

/** content gap ที่ผูกกับหน้านี้ (missing subtopic + คู่แข่งที่ทำ). */
export const pageContentGapSchema = z.object({
  missingSubtopic: z.string().nullable(),
  competitorDomains: z.unknown(),
});

export const pageLinkRowSchema = z.object({
  toUrl: z.string(),
  anchorText: z.string().nullable(),
  rel: z.string().nullable(),
  isInternal: z.boolean(),
});

export const pageImageRowSchema = z.object({
  src: z.string(),
  alt: z.string().nullable(),
  hasAlt: z.boolean(),
});

export const pageFindingSchema = z.object({
  id: z.number(),
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  impactScore: z.number(),
  status: z.string(),
  details: z.unknown(),
  detectedAt: z.coerce.string(),
});

export const pageSnapshotViewSchema = z.object({
  snapshotId: z.number(),
  crawlId: z.number(),
  httpStatus: z.number().nullable(),
  title: z.string().nullable(),
  metaDescription: z.string().nullable(),
  h1: z.string().nullable(),
  headings: z.unknown(),
  wordCount: z.number().nullable(),
  canonical: z.string().nullable(),
  robotsMeta: z.string().nullable(),
  schemaTypes: z.unknown(),
  internalLinks: z.number().nullable(),
  externalLinks: z.number().nullable(),
  imagesTotal: z.number().nullable(),
  imagesMissingAlt: z.number().nullable(),
  lcpMs: z.number().nullable(),
  clsX1000: z.number().nullable(),
  inpMs: z.number().nullable(),
  createdAt: z.coerce.string(),
});

export const pageScoreViewSchema = z.object({
  keywordCoverage: z.number().nullable(),
  healthScore: z.number().nullable(),
  breakdown: z.unknown(),
});

export const pageDetailSchema = z.object({
  page: z.object({
    id: z.number(),
    url: z.string(),
    isIndexable: z.boolean(),
    firstSeenAt: z.coerce.string(),
    lastSeenAt: z.coerce.string(),
  }),
  snapshot: pageSnapshotViewSchema.nullable(),
  score: pageScoreViewSchema.nullable(),
  ranking: z.array(pageRankingSchema),
  backlinks: pageBacklinksSchema.nullable(),
  serp: z.array(pageSerpRowSchema),
  links: z.array(pageLinkRowSchema),
  images: z.array(pageImageRowSchema),
  findings: z.array(pageFindingSchema),
  contentGaps: z.array(pageContentGapSchema),
});
export class PageDetailDto extends createZodDto(pageDetailSchema) {}
