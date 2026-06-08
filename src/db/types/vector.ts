import { customType } from 'drizzle-orm/mysql-core';

/**
 * มิติ (dimension) ของ page_embeddings.embedding — เป็น single source of truth ระหว่าง schema
 * (คอลัมน์ VECTOR) กับ env (VOYAGE_DIM ต้องเท่ากันเป๊ะ ไม่งั้น insert vector ล้มเงียบ ๆ).
 * voyage-3.5 default = 1024; เปลี่ยนค่านี้ต้องทำ migration เปลี่ยนคอลัมน์ด้วย.
 */
export const EMBEDDING_DIM = 1024;

/**
 * MariaDB `VECTOR(n)` — Drizzle ยังไม่มี native type (เอกสาร 01 §1).
 * เก็บเป็น packed float32 little-endian (mysql2 Buffer) — ตรงกับรูปไบนารีที่ MariaDB
 * VECTOR ใช้ภายใน.
 *
 * ⚠️ Drizzle ยังออก `VECTOR INDEX` ในไฟล์ schema ไม่ได้ (issue #3695) → เพิ่ม index +
 * query distance ด้วย raw SQL (ดูเอกสาร 01 §3, §4).
 *
 * หมายเหตุ path การ insert (ยืนยันกับ MariaDB 11.8 จริง): Drizzle mysql2 ส่ง params ผ่าน
 * `client.query` (text protocol) → Buffer ถูก escape เป็น binary literal ที่ VECTOR รับได้.
 * ห้าม insert Buffer ผ่าน prepared/binary protocol (`conn.execute`) — MariaDB จะปฏิเสธว่า
 * "Incorrect vector value". (เคยมีบั๊ก driver #3899 ก็เรื่องเดียวกัน.)
 *
 * pack/unpack แยกเป็นฟังก์ชัน pure (export) เพื่อ (1) unit-test การ serialize ได้โดยไม่แตะ DB
 * และ (2) ให้ smoke test (vector-smoke.ts) reuse แทนที่จะ copy logic ซ้ำ.
 */

/** number[] → packed float32 little-endian Buffer (รูปไบนารีของ MariaDB VECTOR). */
export function packVectorLE(values: number[]): Buffer {
  const buf = Buffer.allocUnsafe(values.length * 4);
  for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i], i * 4);
  return buf;
}

/** packed float32 LE Buffer → number[] (ทางกลับของ packVectorLE). */
export function unpackVectorLE(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 4) out.push(buf.readFloatLE(i));
  return out;
}

export const vector = (name: string, config: { dimensions: number }) =>
  customType<{
    data: number[];
    driverData: Buffer;
    config: { dimensions: number };
  }>({
    dataType(cfg) {
      return `vector(${cfg!.dimensions})`;
    },
    toDriver(value) {
      return packVectorLE(value);
    },
    fromDriver(value) {
      return unpackVectorLE(value);
    },
  })(name, config);
