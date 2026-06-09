import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * ผลของ GET /config — public config ที่ FE ต้องรู้ "ก่อน" build ฟอร์ม. ตอนนี้มีแค่
 * crawlSiteMaxPages = เพดาน maxPages ของ site crawl (env CRAWLER_SITE_MAX_PAGES,
 * single source of truth) — FE อ่านมาตั้ง max ของ input + clamp แทน hardcode กัน FE/BE
 * drift (เคสเดิม: FE max=1000 แต่ BE cap=200 → กรอกเกินแล้ว error). ใช้ document `data`
 * ใน envelope (เอกสาร 04 §6) เหมือน HealthStatusDto.
 */
export const appConfigSchema = z.object({
  crawlSiteMaxPages: z.number().int().positive(),
});

export class AppConfigDto extends createZodDto(appConfigSchema) {}
