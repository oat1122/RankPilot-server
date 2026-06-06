import { sql, eq, and, ne } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { pageEmbeddings } from '../schema';
import type * as schema from '../schema';

/**
 * Reference query — cosine similarity / cannibalization (เอกสาร 01 §4).
 *
 * หาเพจที่เนื้อหาใกล้กับ targetEmbedding ภายในโปรเจค (ผู้ต้องสงสัย cannibalization).
 * เงื่อนไขให้ VECTOR INDEX ทำงาน: `ORDER BY VEC_DISTANCE_*(col, vec) ASC` (หรือ alias) + LIMIT.
 * cosine distance ต่ำ = คล้ายมาก → similarity = 1 - dist. (voyage embeddings unit-normalized แล้ว)
 *
 * VEC_FromText รับ JSON array text → ส่ง targetEmbedding เป็น JSON.stringify(number[]).
 */
export async function similarPages(
  db: MySql2Database<typeof schema>,
  projectId: number,
  targetEmbedding: number[],
  excludePageId: number,
) {
  const q = JSON.stringify(targetEmbedding);
  return db
    .select({
      pageId: pageEmbeddings.pageId,
      dist: sql<number>`vec_distance_cosine(${pageEmbeddings.embedding}, vec_fromtext(${q}))`.as(
        'dist',
      ),
    })
    .from(pageEmbeddings)
    .where(
      and(
        eq(pageEmbeddings.projectId, projectId),
        ne(pageEmbeddings.pageId, excludePageId),
      ),
    )
    .orderBy(sql`dist`) // ASC + LIMIT → optimizer ใช้ VECTOR INDEX
    .limit(10);
}
