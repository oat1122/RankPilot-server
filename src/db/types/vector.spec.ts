import { packVectorLE, unpackVectorLE } from './vector';

/**
 * Serialize ของ MariaDB VECTOR custom type (เอกสาร 01 §1) — จุดที่เปราะที่สุดของ data layer
 * (ถ้า byte layout เพี้ยน embedding ทุกตัวพังเงียบ ๆ). ทดสอบ pure ไม่แตะ DB:
 * round-trip + byte layout float32 little-endian + ความยาว/มิติ.
 *
 * พฤติกรรมจริง (insert ผ่าน Drizzle → MariaDB 11.8 → select กลับ) ยืนยันใน vector-smoke.ts
 * (`npm run db:vector:check`); สเปคนี้ล็อก contract ของ pack/unpack ให้ test ทุกครั้งโดยไม่พึ่ง DB.
 */
describe('vector custom type — packVectorLE / unpackVectorLE', () => {
  it('round-trip ค่าที่ float32 แทนได้ตรง (เป๊ะ)', () => {
    // 0.25 / -0.75 / 0.5 / 1 / 0 / -2 เป็น dyadic rational → float32 เก็บได้ไม่เพี้ยน
    const v = [0.25, -0.75, 0.5, 1, 0, -2];
    expect(unpackVectorLE(packVectorLE(v))).toEqual(v);
  });

  it('round-trip ค่าทศนิยมทั่วไปด้วยความแม่นระดับ float32', () => {
    const v = [0.1, 0.2, -0.333333, 3.14159, 2.718281828];
    const out = unpackVectorLE(packVectorLE(v));
    out.forEach((n, i) => expect(n).toBeCloseTo(v[i], 5));
  });

  it('pack: ได้ buffer ยาว 4 ไบต์ต่อ 1 ค่า', () => {
    expect(packVectorLE([1, 2, 3]).length).toBe(12);
    expect(packVectorLE([]).length).toBe(0);
    expect(packVectorLE(new Array<number>(1024).fill(0)).length).toBe(4096);
  });

  it('byte layout เป็น float32 little-endian จริง', () => {
    // 1.0 (f32) = 0x3F800000 → LE bytes = 00 00 80 3F
    expect([...packVectorLE([1])]).toEqual([0x00, 0x00, 0x80, 0x3f]);
    // 0.0 = ทั้งสี่ไบต์เป็นศูนย์
    expect([...packVectorLE([0])]).toEqual([0x00, 0x00, 0x00, 0x00]);
    // -2.0 (f32) = 0xC0000000 → LE = 00 00 00 C0
    expect([...packVectorLE([-2])]).toEqual([0x00, 0x00, 0x00, 0xc0]);
  });

  it('unpack: นับจำนวนค่าจากความยาว buffer (มิติคงเดิม)', () => {
    expect(
      unpackVectorLE(packVectorLE(new Array<number>(1024).fill(0.5))),
    ).toHaveLength(1024);
    expect(unpackVectorLE(Buffer.alloc(0))).toEqual([]);
  });

  it('cross-check กับ Buffer.readFloatLE โดยตรง', () => {
    const buf = packVectorLE([0.25, -0.75]);
    expect(buf.readFloatLE(0)).toBe(0.25);
    expect(buf.readFloatLE(4)).toBe(-0.75);
  });
});
