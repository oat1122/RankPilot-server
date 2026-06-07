import { z } from 'zod';

/**
 * ผลการอ่านเพจของ "bot" — map ตรงกับ fields ของ page_snapshots (เอกสาร 01 §2)
 * เพื่อให้ขั้น persist (Phase 1) เอาไปเขียน DB ได้ตรง ๆ.
 * เป็น Zod schema ตัวเดียว (เอกสาร 04 §6) — ตั้งใจย้ายไป packages/shared ภายหลัง.
 */
export const crawlLinkSchema = z.object({
  url: z.string(),
  anchorText: z.string().nullable(),
  rel: z.string().nullable(),
  isInternal: z.boolean(),
});

export const crawlHeadingsSchema = z.object({
  h1: z.array(z.string()),
  h2: z.array(z.string()),
  h3: z.array(z.string()),
});

/** 1 รูปในหน้า — map ตรงกับ page_images (เอกสาร 01 §2): src/alt/hasAlt (bytes เก็บภายหลัง). */
export const crawlImageSchema = z.object({
  src: z.string(), // absolute URL (resolve กับ base) — page_images.src NOT NULL
  alt: z.string().nullable(),
  hasAlt: z.boolean(),
});

export const crawlResultSchema = z.object({
  url: z.string(), // URL ที่ขอ (normalize แล้ว)
  finalUrl: z.string(), // หลัง follow redirect
  httpStatus: z.number().int(),
  contentType: z.string(),
  fetchedAt: z.string(), // ISO 8601
  title: z.string().nullable(),
  metaDescription: z.string().nullable(),
  h1: z.string().nullable(),
  headings: crawlHeadingsSchema,
  paragraphs: z.array(z.string()), // ข้อความใน <p> แต่ละย่อหน้า — สำคัญต่อการวิเคราะห์เนื้อหา/โครงสร้าง (เอกสาร 01)
  canonical: z.string().nullable(),
  robotsMeta: z.string().nullable(),
  schemaTypes: z.array(z.string()), // @type จาก JSON-LD
  links: z.array(crawlLinkSchema),
  internalLinks: z.number().int(),
  externalLinks: z.number().int(),
  images: z.object({ total: z.number().int(), missingAlt: z.number().int() }), // นับรวม
  imageRows: z.array(crawlImageSchema), // รายรูป (→ page_images, เอกสาร 01 §2)
  wordCount: z.number().int(),
  contentHash: z.string(), // sha1(bodyText) — เทียบว่าหน้าเปลี่ยนไหม (เอกสาร 01)
  bodyText: z.string(),
});

export type CrawlLink = z.infer<typeof crawlLinkSchema>;
export type CrawlHeadings = z.infer<typeof crawlHeadingsSchema>;
export type CrawlImage = z.infer<typeof crawlImageSchema>;
export type CrawlResult = z.infer<typeof crawlResultSchema>;

/**
 * ผลของ crawl 1 หน้า: CrawlResult (→ job.returnvalue/persist) + rawHtml ดิบ(→ R2 เท่านั้น,
 * ไม่ใส่ใน CrawlResult กัน bloat ใน Redis/response). rawHtml = null เมื่อไม่ใช่ HTML.
 */
export type CrawledPage = { result: CrawlResult; rawHtml: string | null };
