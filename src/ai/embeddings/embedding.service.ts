import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DB } from '../../db/db.module';
import type { Db } from '../../db/db.module';
import { pageEmbeddings } from '../../db/schema';
import { VoyageClient } from './voyage.client';

/** คุม token/cost ของ Voyage (voyage-3.5 รับ ~32k tokens; ตัดเนื้อหาให้พอเป็นตัวแทนหน้า). */
const MAX_EMBED_CHARS = 8000;

export interface EmbedTextParts {
  title: string | null;
  h1: string | null;
  headings: { h1: string[]; h2: string[]; h3: string[] } | null;
  paragraphs: string[] | null;
}

/**
 * EmbeddingService (เอกสาร 02 Phase 6) — สร้าง/เก็บ embedding ของหน้า (Voyage) + คำนวณ cosine
 * similarity สำหรับ cannibalization (เอกสาร 01 §4). เรียกจาก AiRepo.loadPageContext แบบ best-effort
 * (gate VOYAGE_API_KEY: ไม่มี key → skip, similarity คงเป็น null เหมือน Phase 2). buildText เป็น pure
 * → unit test ได้. insert ผ่าน Drizzle (toDriver pack float32 LE — memory: insert ใช้ conn.query ได้);
 * อ่าน vector กลับใช้ vec_totext (text protocol) เลี่ยง fromDriver/Buffer.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly voyage: VoyageClient,
    private readonly config: ConfigService,
  ) {}

  /** มี Voyage key ไหม (AiRepo ใช้ gate best-effort). */
  isConfigured(): boolean {
    return this.voyage.isConfigured();
  }

  /** ข้อความตัวแทนเนื้อหาหน้า (title+h1+h2/h3+ย่อหน้า) → embed. pure + truncate (คุม cost). */
  buildText(parts: EmbedTextParts): string {
    const lines: string[] = [];
    if (parts.title) lines.push(parts.title);
    if (parts.h1 && parts.h1 !== parts.title) lines.push(parts.h1);
    if (parts.headings)
      lines.push([...parts.headings.h2, ...parts.headings.h3].join(' · '));
    if (parts.paragraphs?.length) lines.push(parts.paragraphs.join('\n'));
    return lines.filter(Boolean).join('\n').slice(0, MAX_EMBED_CHARS).trim();
  }

  private hash(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }

  private model(): string {
    return this.config.get<string>('VOYAGE_MODEL')!;
  }

  /**
   * คืน embedding ของหน้า. dedup ด้วย contentHash: มี row เดิม (pageId+model+hash) → อ่านกลับด้วย
   * vec_totext; ไม่งั้น embed ใหม่ (Voyage) + insert page_embeddings. throw ถ้า Voyage ล้ม (caller
   * จับ best-effort).
   */
  async ensureEmbedding(input: {
    projectId: number;
    pageId: number;
    crawlId: number;
    text: string;
  }): Promise<number[]> {
    const hash = this.hash(input.text);
    const model = this.model();
    const existing = await this.db
      .select({ vec: sql<string>`vec_totext(${pageEmbeddings.embedding})` })
      .from(pageEmbeddings)
      .where(
        and(
          eq(pageEmbeddings.pageId, input.pageId),
          eq(pageEmbeddings.model, model),
          eq(pageEmbeddings.contentHash, hash),
        ),
      )
      .orderBy(desc(pageEmbeddings.createdAt))
      .limit(1);
    if (existing.length) return JSON.parse(existing[0].vec) as number[];

    const [vec] = await this.voyage.embed([input.text], 'document');
    if (!vec || !vec.length) throw new Error('voyage returned empty embedding');
    await this.db.insert(pageEmbeddings).values({
      projectId: input.projectId,
      pageId: input.pageId,
      crawlId: input.crawlId,
      model,
      contentHash: hash,
      embedding: vec,
    });
    return vec;
  }

  /**
   * cosine similarity (1 - cosine distance, clamp 0-1) ระหว่าง targetVec กับ embedding ที่ใกล้สุด
   * ของแต่ละ candidate page (vec_distance_cosine + vec_fromtext — เอกสาร 01 §4). candidate ที่ยังไม่มี
   * embedding → ไม่อยู่ใน map (similarity คงเป็น null).
   */
  async cosineForCandidates(
    targetVec: number[],
    candidatePageIds: number[],
  ): Promise<Map<number, number>> {
    if (!candidatePageIds.length) return new Map();
    const q = JSON.stringify(targetVec);
    const rows = await this.db
      .select({
        pageId: pageEmbeddings.pageId,
        dist: sql<number>`vec_distance_cosine(${pageEmbeddings.embedding}, vec_fromtext(${q}))`.as(
          'dist',
        ),
      })
      .from(pageEmbeddings)
      .where(
        and(
          inArray(pageEmbeddings.pageId, candidatePageIds),
          // กรอง model เดียวกับ targetVec — ถ้า VOYAGE_MODEL เปลี่ยน embedding รุ่นเก่าจะอยู่คนละ
          // vector space → cosine ไม่มีความหมาย (แต่ vec_distance_cosine ยังคำนวณได้ถ้ามิติเท่า)
          eq(pageEmbeddings.model, this.model()),
        ),
      );

    // page อาจมีหลาย embedding (ต่อ crawl) → เก็บ distance ต่ำสุด (คล้ายสุด) ต่อ page
    const best = new Map<number, number>();
    for (const r of rows) {
      const dist = Number(r.dist);
      if (!Number.isFinite(dist)) continue;
      const prev = best.get(r.pageId);
      if (prev === undefined || dist < prev) best.set(r.pageId, dist);
    }
    const sims = new Map<number, number>();
    for (const [pageId, dist] of best)
      sims.set(pageId, Math.max(0, Math.min(1, 1 - dist)));
    return sims;
  }
}
