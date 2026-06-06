-- เอกสาร 01 §3 — VECTOR INDEX (raw migration)
-- Drizzle generate ออก `VECTOR INDEX` ไม่ได้ (issue #3695) → เพิ่มเองหลัง drizzle-kit generate.
-- ไฟล์นี้ "ไม่อยู่ใน" migrations/meta/_journal.json โดยตั้งใจ → drizzle migrate จะไม่แตะ;
-- custom runner (src/db/migrate.ts) apply ไฟล์นี้เองแบบ idempotent หลัง journal migrations.
-- เงื่อนไข index ทำงาน: ORDER BY VEC_DISTANCE_COSINE(embedding, vec) ASC + LIMIT (เอกสาร 01 §4).
ALTER TABLE page_embeddings ADD VECTOR INDEX vx_page_emb (embedding) M=8 DISTANCE=cosine;
