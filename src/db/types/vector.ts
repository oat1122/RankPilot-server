import { customType } from 'drizzle-orm/mysql-core';

/**
 * MariaDB `VECTOR(n)` — Drizzle ยังไม่มี native type (เอกสาร 01 §1).
 * เก็บเป็น packed float32 little-endian ผ่าน driver (mysql2 Buffer).
 *
 * ⚠️ Drizzle ยังออก `VECTOR INDEX` ในไฟล์ schema ไม่ได้ (issue #3695) และ insert binary
 * เคยมีบั๊ก (#3899) → สร้างคอลัมน์ผ่าน vector() แต่เพิ่ม index + query distance ด้วย raw SQL
 * (ดูเอกสาร 01 §3, §4). ถ้า insert ผ่าน driver พลาด ให้ fallback เป็น VEC_FromText('[...]').
 */
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
      const buf = Buffer.allocUnsafe(value.length * 4);
      for (let i = 0; i < value.length; i++) buf.writeFloatLE(value[i], i * 4);
      return buf;
    },
    fromDriver(value) {
      const out: number[] = [];
      for (let i = 0; i < value.length; i += 4) out.push(value.readFloatLE(i));
      return out;
    },
  })(name, config);
