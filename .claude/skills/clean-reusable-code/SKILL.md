---
name: clean-reusable-code
description: Use when writing, refactoring, or reviewing TypeScript in this RankPilot monorepo with an eye on code quality — eliminating duplication, extracting reusable pieces, and keeping code readable. Triggers — "refactor", "ทำให้สะอาดขึ้น", "โค้ดซ้ำ", "duplicate code", "DRY", "extract helper", "extract schema", "reuse", "ใช้ซ้ำ", "อ่านยาก", "อ่านง่ายขึ้น", "clean up", "code smell", "ฟังก์ชันยาวไป", "nested ลึก", "magic number", "ตั้งชื่อตัวแปร", "naming", "แยกไฟล์", "where should this code live", "อยากให้ maintain ง่าย", or when you notice copy-pasted blocks, a re-declared Zod schema/enum, a fat method with deep nesting, or `process.env`/magic strings that should be centralized. Complements `api-foundation` — this skill is the cross-cutting quality layer over **all** of `apps/{api,worker,web}` + `packages/{db,shared,ai}`. Skip for pure "make it work" spikes the user explicitly wants quick-and-dirty, dependency/config bumps, or generated files (migrations, OpenAPI client).
---

# Clean & Reusable Code — RankPilot

> ใช้คู่กับ `../api-foundation/SKILL.md` (วิธี *สร้าง* API building block) — สกิลนี้คือชั้น *คุณภาพ* ที่คร่อมทุก package. อ้าง `../../../../docs/00-overview-and-stack.md` §2/§4 และ `04-monorepo-bootstrap.md` §6 (Zod เดียว, ห้าม duplicate enum).

โค้ดสะอาด = **อ่านครั้งเดียวเข้าใจ** + **แก้ที่เดียวจบ**. สองอย่างนี้คือเป้า ทุกกฎด้านล่างมีไว้รับใช้สองข้อนี้ ไม่ใช่กฎเพื่อกฎ.

## หลักการ (ทำไมถึงสำคัญ)

1. **One source of truth** — concept หนึ่งประกาศที่เดียว. Zod schema, enum สถานะ (crawl/finding/recommendation), constant, type → ประกาศครั้งเดียวแล้ว import ไปใช้. ของซ้ำสองที่ = วันหนึ่งมันจะ drift คนละทาง แล้วเกิดบั๊กเงียบ (เอกสาร 04 §6 ห้าม duplicate enum).
2. **DRY แบบมีวิจารณญาณ (rule of three)** — เห็นซ้ำ *ครั้งที่สาม* ค่อยสกัด. ซ้ำสองครั้งที่ "บังเอิญเหมือน" แต่คนละเหตุผล อย่าเพิ่งรวบ — **abstraction ผิดแพงกว่า copy-paste**. ถามก่อนสกัด: "ถ้า requirement เปลี่ยน ทั้งสองจุดจะเปลี่ยน *พร้อมกัน* ไหม?" ใช่ = สกัด, ไม่ใช่ = ปล่อยไว้.
3. **โค้ดอยู่ถูกที่ (monorepo boundaries)** — logic ใช้ร่วม FE↔BE (zod/type/enum/constant) → `packages/shared`; งานหนัก → `worker`; LangGraph → `packages/ai`; DB → `packages/db`. อย่าฝัง logic ที่ควร share ไว้ใน app เดียว แล้วต้อง copy ข้าม app ทีหลัง.
4. **Adapter บาง, core หนา แต่ cohesive** — controller บาง (validate→delegate), service ถือ logic. แต่ service ก็ต้อง single-responsibility: ถ้า service ทำหลายเรื่องไม่เกี่ยวกัน = แตกเป็นหลาย service/helper.
5. **อ่านง่ายชนะฉลาด** — ชื่อสื่อความหมาย, guard clause/early-return แทน nesting ลึก, named constant แทน magic number/string, ฟังก์ชันสั้นทำเรื่องเดียว. โค้ดถูกอ่านบ่อยกว่าเขียน 10 เท่า.
6. **reuse ของที่มีอยู่ก่อนเขียนใหม่** — `ConfigService`, `ZodValidationPipe`, `createZodDto` (nestjs-zod), pino, `@nestjs/axios` มีให้แล้ว. เขียน util ใหม่ทับของที่ framework ให้ = หนี้.

## เมื่อไรควร "สกัด" และเมื่อไรไม่ควร

```
เห็นโค้ดคล้ายกัน → ถามตามลำดับ:
  1. ซ้ำครบ 3 จุดหรือยัง?           ไม่ → รอ (จด TODO ได้)
  2. เปลี่ยนพร้อมกันเสมอไหม?         ไม่ → คนละ concept อย่ารวบ
  3. ตั้งชื่อ abstraction ได้ชัดไหม?  ไม่ → ยังไม่เข้าใจพอจะสกัด
  ครบ 3 ข้อ → สกัดไป shared ที่เหมาะ (ดูหลักการ 3)
```
> ตัวอย่าง "บังเอิญเหมือน": validation ของ `email` กับของ `slug` ตอนนี้เป็น `z.string().min(1)` เหมือนกัน — แต่คนละเหตุผล วันหน้า email ต้อง `.email()` ส่วน slug ต้อง regex. รวบเป็น schema เดียว = ผูกสองอย่างที่จะแยกกัน.

## Pattern (copy-paste ได้ — ปรับชื่อ)

### A. สกัด Zod schema/type ซ้ำ → ที่เดียว
```ts
// ❌ ก่อน: schema เดียวกันถูก redeclare ในหลาย controller
// keywords.controller.ts และ projects.controller.ts ต่างมี:
const pagination = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20) });

// ✅ หลัง: ประกาศครั้งเดียว (วันนี้: src/common/ ; เป้าหมาย monorepo: packages/shared)
// src/common/schemas/pagination.schema.ts
import { z } from 'zod';
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;
// แล้วทุกที่ import ตัวเดียวกัน — แก้กติกา paging ที่เดียว มีผลทั้งระบบ
```

### B. guard clause แทน nesting ลึก
```ts
// ❌ ก่อน: pyramid of doom
async function enrich(id: string) {
  const kw = await repo.find(id);
  if (kw) {
    if (kw.status === 'pending') {
      if (budget.hasUnits()) {
        return doEnrich(kw);
      } else { throw new Error('no budget'); }
    } else { throw new Error('bad status'); }
  } else { throw new Error('not found'); }
}

// ✅ หลัง: early-return — เคสผิดออกก่อน, happy path อยู่ระดับนอกสุด อ่านรวด
async function enrich(id: string) {
  const kw = await repo.find(id);
  if (!kw) throw new NotFoundException('keyword not found');
  if (kw.status !== 'pending') throw new ConflictException('keyword not pending');
  if (!budget.hasUnits()) throw new ServiceUnavailableException('ahrefs budget exhausted');
  return doEnrich(kw);
}
```

### C. named constant แทน magic number/string
```ts
// ❌ if (keywords.length > 20) ... ; queue.add('enrich', d, { attempts: 3 });
// ✅ ตั้งชื่อบอก "ทำไม" — ตัวเลขมาจากเอกสาร 00 §4 (crawl top 20%)
const TOP_TRAFFIC_CRAWL_RATIO = 0.2;          // เอกสาร 00 §4 ข้อ 2
const ENRICH_JOB_MAX_ATTEMPTS = 3;
// constant ใช้ข้าม app → packages/shared/constants
```

### D. แยกความรับผิดชอบ (extract method)
```ts
// service ยาวที่ทำ 3 เรื่อง (parse → validate budget → enqueue) ปนกัน
// → แตกเป็น method สั้นชื่อบอกหน้าที่ แล้ว orchestrate
async requestEnrichment(input: EnrichInput) {
  const keywords = this.selectTopTraffic(input.keywords);   // เรื่อง 1
  this.assertBudget(keywords.length);                        // เรื่อง 2
  return this.enqueue(keywords);                             // เรื่อง 3
}
```

### E. reuse framework แทนเขียนเอง
```ts
// ❌ const key = process.env.AHREFS_API_KEY;  // อ่านดิบ + ไม่ validate
// ✅ this.config.get<string>('AHREFS_API_KEY')  // typed + fail-fast (เพิ่มใน envSchema)
// ❌ เขียน try/catch + format error เอง ทุก method
// ✅ โยน HttpException ของ Nest (NotFoundException ฯลฯ) ให้ exception filter จัด
```

## Decision Matrix

| เจออะไร | ทำ |
|---|---|
| schema/enum/type ซ้ำ ≥3 จุด | สกัดไป `packages/shared` (วันนี้ `src/common/`) ประกาศครั้งเดียว |
| ซ้ำ 2 จุด "บังเอิญเหมือน" | ปล่อย + จด TODO — อย่ารวบ concept คนละเรื่อง |
| nesting ลึก ≥3 ชั้น | guard clause / early-return |
| magic number/string | named constant (ชื่อบอกเหตุผล) |
| method ทำหลายเรื่อง | extract method ชื่อบอกหน้าที่ → orchestrate |
| logic ใช้ร่วมหลาย app | ย้ายไป package ที่เหมาะ (shared/db/ai) |
| `process.env` / error format เอง | reuse `ConfigService` / Nest exceptions |
| ชื่อ `d`, `tmp`, `res2`, `data2` | rename สื่อความหมาย |

## Code smell → แก้

- **Shotgun surgery** (แก้ feature เดียวต้องตามแก้ 5 ไฟล์) → ของที่ควรอยู่ด้วยกันกระจาย → รวบเป็นโมดูล/หน่วยเดียว
- **Copy-paste block** → สกัด (ผ่าน rule of three)
- **Long parameter list** (>4 args) → รวมเป็น object/DTO ที่มีชื่อ
- **Boolean trap** `fn(true, false)` → enum/object option ที่อ่านออก
- **Comment อธิบายโค้ดงง** → ส่วนใหญ่แก้ด้วยการตั้งชื่อ/แตกฟังก์ชัน ดีกว่าคอมเมนต์ (คอมเมนต์ "ทำไม" เก็บไว้, คอมเมนต์ "อะไร" ลบโดยเขียนโค้ดให้ชัด) — แต่คอมเมนต์ไทยอ้างเอกสาร `เอกสาร NN §M` คงไว้ตามสไตล์ repo
- **Dead code / commented-out** → ลบ (git เก็บประวัติให้แล้ว)

## ห้ามทำ

- ❌ over-abstract: สร้าง `BaseService<T>` / generic util ตอนมีผู้ใช้คนเดียว — รอจนซ้ำจริง
- ❌ DRY ข้าม boundary ผิด: import ของ `worker` มาใช้ใน `api` ตรง ๆ → ถ้าต้อง share ย้ายไป `packages/shared` ก่อน
- ❌ refactor พ่วงเปลี่ยน behavior เงียบ ๆ — clean-up ต้อง behavior-preserving; เปลี่ยน logic แยก commit/แยกหัวข้อ
- ❌ rename/ย้ายไฟล์โดยไม่ตามแก้ผู้เรียก → ต้อง build ผ่าน
- ❌ ลบ duplication ด้วยการสร้าง coupling ที่แย่กว่าเดิม (สอง module พึ่ง util เดียวทั้งที่ logic จะแยกกัน)
- ❌ ตั้งชื่อย่อ/กำกวม (`mgr`, `tmp`, `data2`) — ชื่อคือ documentation
- ❌ comment-out โค้ดเก่าทิ้งไว้ — ลบ
- ❌ ยัด logic ที่ควร share ไว้ใน controller/route — ย้ายลง service/shared

## Checklist หลัง refactor / ก่อน commit

- [ ] ไม่มี block ซ้ำที่ผ่าน rule of three แล้วยังไม่สกัด
- [ ] schema/enum/type/constant ใช้ร่วม อยู่ที่เดียว (ไม่ redeclare)
- [ ] ไม่มี nesting ลึก ≥3 ชั้นที่เลี่ยงได้ด้วย guard clause
- [ ] ไม่มี magic number/string ที่ควรเป็น named constant
- [ ] ชื่อ variable/function สื่อความหมาย (ไม่มี `tmp`/`d`/`res2`)
- [ ] โค้ดอยู่ถูก package (ไม่มี cross-app import ที่ควรไป shared)
- [ ] reuse framework (ConfigService/Nest exceptions/createZodDto) ไม่เขียนทับ
- [ ] behavior ไม่เปลี่ยน (ถ้าตั้งใจเปลี่ยน = แยกออกชัดเจน)
- [ ] `npm run build` + `npm run lint` ผ่าน
