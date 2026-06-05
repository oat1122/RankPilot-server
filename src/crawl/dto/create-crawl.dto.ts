import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Input ของ POST /crawls — Zod เป็น source of truth (เอกสาร 04 §6):
 * reuse ได้ทั้ง DTO (api) และ payload ของ job (worker).
 */
export const createCrawlSchema = z.object({
  url: z.string().url(),
});

export class CreateCrawlDto extends createZodDto(createCrawlSchema) {}
