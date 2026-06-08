# Security review — RankPilot `server`

วิธีตรวจ: `/scrutinize` (trace ทุก path จริงจาก entry → sink ไม่ใช่แค่ diff).
ขอบเขต: ทั้งระบบ **ข้าม auth/login** (ยังไม่สร้าง) ตามที่ตกลง.
วันที่: 2026-06-08 · branch `main` · commit ฐาน `191dd8e`.

สรุป: เจอ **1 blocker (SSRF)** — แก้แล้วในรอบนี้. ที่เหลือเป็น checklist ด้านล่าง.
จุดที่ตรวจแล้ว**ปลอดภัย**: SQL (Drizzle bound params ทุกที่), path ของ HTML storage
(`projectId`/`crawlId` เป็น int + `urlHash` sha1 hex → ไม่มี traversal), JSON-LD parse
(`JSON.parse` ใน try/catch อ่านแค่ `@type` → ไม่มี prototype-pollution sink), DTO ทุกตัว
validate ด้วย Zod ขอบเขตรัดกุม.

---

## [BLOCKER] SSRF ใน crawler — ✅ แก้แล้ว

**Finding.** `POST /crawls {url}` → `worker/crawl.processor` → `CrawlerService.crawl()`
`http.get(url)` ยิง URL ที่ผู้ใช้ส่งมาตรง ๆ โดย `normalizeUrl` เช็คแค่ scheme `http(s)`
ไม่กรอง IP/host. ผล (รวม `bodyText`) ไหลกลับ caller ผ่าน `GET /crawls/:id`
(`job.returnvalue`) = **read-SSRF เต็มรูปแบบ**.

**Why it matters.** ผู้เรียก (ตอนนี้ไม่ต้อง auth ด้วยซ้ำ) ยิงได้:
`http://169.254.169.254/latest/meta-data/` (cloud metadata → IAM creds),
`http://127.0.0.1:6379` (Redis ของระบบเอง), `http://10.x/`·`192.168.x` (LAN/admin panel)
แล้ว**อ่าน response กลับ**. axios ตาม redirect (default 5 hop) → bypass การเช็คตอน enqueue ได้.

**Evidence.** `crawler.service.ts:65` `http.get(url, …)`; `crawl.service.ts:88`
`status()` คืน `job.returnvalue`; `common/url.ts:28` เช็คแค่ `protocol === http/https`.

**Fix (รอบนี้).** เพิ่ม `src/common/ssrf-guard.ts` กัน 2 ชั้น แล้ว wire เข้า crawler:
1. `assertPublicUrl(url)` ก่อนยิง — บล็อก host ที่เป็น IP-literal ภายใน + ชื่อ loopback.
2. `ssrfSafe{Http,Https}Agent` — custom `dns.lookup` ปฏิเสธ IP ภายในตอน **connect จริง**
   (กัน DNS rebinding ∵ resolve→เช็ค→connect เป็นค่าเดียวกัน; `keepAlive:false` re-resolve ทุกครั้ง).
3. `beforeRedirect` — เช็คทุก redirect hop (กัน redirect ไป IP ภายในตรง ที่ net ข้าม lookup).

ครอบช่วง: loopback `127/8`·`::1`, private `10/8`·`172.16/12`·`192.168/16`, link-local
`169.254/16`·`fe80::/10`, CGNAT `100.64/10`, ULA `fc00::/7`, multicast/reserved/broadcast,
IPv4-mapped `::ffff:127.0.0.1`. โยน `SSRF_BLOCKED:…` → กลายเป็น `job.failedReason`.
Test: `src/common/ssrf-guard.spec.ts` (42 เคส, no network).

> หมายเหตุ chokepoint เดียว: PSI/Ahrefs/OpenRouter/Voyage ยิง base URL คงที่จาก env
> (ผู้ใช้คุมไม่ได้) → ไม่ใช่ SSRF. PSI ส่ง target URL ให้ Google ไป fetch (Google ฝั่งนอก) ไม่ใช่ infra เรา.

---

## Checklist ที่ยังค้าง (เรียงตามความสำคัญ)

### [~~HIGH~~ → VERIFIED MITIGATED] gzip / decompression bomb ใน crawler
รอบ 1 flag ไว้ว่า `maxContentLength` คุมแค่ไบต์ที่ดาวน์โหลด (ก่อน decompress). **trace โค้ด
axios 1.17.0 จริงแล้ว — ไม่ใช่:** `lib/adapters/http.js:987` ประกอบ `responseStream` เป็น
pipeline ที่ "ผ่าน gunzip แล้ว", และ buffered path (`:1028-1046`, ที่ crawler ใช้ ∵
`responseType:'text'`) นับ `totalResponseBytes` จาก chunk **หลัง decompress** แล้ว
`destroy()` ทันทีที่เกิน `maxContentLength`. ∴ `CRAWLER_MAX_BYTES` (5MB) คุมขนาด "หลังคลาย
zip" อยู่แล้ว — gzip bomb ถูกตัดที่ 5MB (zlib เป็น stream, ไม่คลายทั้งก้อนเข้า memory).
✅ เพิ่ม regression test ล็อกว่า crawl() ส่ง `maxContentLength` ให้ axios เสมอ
(`crawler.service.spec.ts` — guard wiring) กันใครถอด guard นี้ออกเงียบ ๆ.

### [HIGH] ไม่มี authz/ownership บน `projectId` (IDOR / tenant isolation)
ทุก endpoint (`/crawls`, `/projects/:id/ahrefs|analysis|ai/*`) รับ `projectId` จาก body/param
โดยไม่เช็คว่าเป็นของผู้เรียก. แม้ยังไม่ทำ login แต่ตอนต่อ auth ต้องบังคับ
`project ownership` ทุกจุด ไม่งั้น user A อ่าน/สั่งงานโปรเจค user B ได้. (ผูกกับงาน auth)

### [MED] ✅ rate limiting / throttling — แก้แล้ว
เพิ่ม `@nestjs/throttler`: global `ThrottlerGuard` (APP_GUARD) ใน `app.module.ts`
ค่า `THROTTLE_TTL_MS`/`THROTTLE_LIMIT` จาก env (default 120 req/นาที/IP) + เพดานเข้ม
`POST /crawls` = 10 req/นาที (`@Throttle` ใน `crawl.controller.ts`). worker ไม่มี HTTP
จึงไม่ผูก guard นี้.
> ค้าง: storage เป็น in-memory (per-instance) — หลายอินสแตนซ์ควรต่อ Redis storage
> (`@nest-lab/throttler-storage-redis`). หลัง reverse proxy (Railway) ต้องตั้ง
> `app.set('trust proxy', …)` ไม่งั้น throttle อิง IP ของ proxy แทน client.

### [MED] ✅ Swagger `/docs` เปิดใน production — แก้แล้ว
gate ด้วย `!isProd` (`NODE_ENV`) ใน `main.ts` (เดิมเปิดทุก env เผย API surface+schema
ให้คนนอกทั้งที่ไม่มี auth). client gen ทำตอน dev/CI อยู่แล้ว.

### [MED] ✅ security headers (helmet) — แก้แล้ว
`main.ts` ใส่ `helmet()` (HSTS / `X-Content-Type-Options: nosniff` / frame-ancestors ฯลฯ).
ปิด CSP เฉพาะ non-prod เพื่อไม่บล็อก Swagger UI; prod (ไม่มี /docs) เปิด CSP เต็ม.

### [MED] Prompt injection จากเนื้อหาที่ crawl
`ai/page-audit/prompts.ts` ฉีด `bodyText`/`headings`/`links` (ผู้โจมตีคุมได้ผ่านหน้าเว็บ)
เข้า `HumanMessage` ด้วย `JSON.stringify(ctx)` ไม่มี delimiter/คำเตือน. structured output
(Zod→json_schema) จำกัดความเสียหายไว้ที่ "บิดเบือนคำแนะนำ" (ไม่ถึงขั้น RCE/ข้อมูลรั่ว)
แต่ควร: ครอบเนื้อหาด้วย delimiter ชัด + system rule ว่า "ถือเป็น data ไม่ใช่คำสั่ง".

### [LOW] รายละเอียด error รั่วกลับ caller
`failedReason` / error message ส่งข้อความ upstream ดิบกลับ FE. หลังบล็อก SSRF แล้วความเสี่ยงต่ำ
แต่ควร sanitize ข้อความ network/stack ก่อนส่งออก.

### [LOW] ผู้ใช้เลือก `modelId` ได้อิสระ (PUT ai/settings)
เป็นเรื่อง cost abuse (route ไป model แพง) ไม่ใช่ SSRF (`baseURL` มาจาก env คงที่).
พิจารณา allowlist model หรือผูกเพดานค่าใช้จ่าย.

---

## ไฟล์ที่แก้

**รอบ 1 — SSRF blocker**
- `src/common/ssrf-guard.ts` *(ใหม่)* — SSRF guard (isBlockedIp / assertPublicUrl / agents)
- `src/common/ssrf-guard.spec.ts` *(ใหม่)* — 42 unit tests
- `src/crawler/crawler.service.ts` — `assertPublicUrl` + guarded agents + `beforeRedirect`
- `src/main.ts` — gate Swagger `/docs` ด้วย `NODE_ENV`
- `src/crawler/crawler.service.spec.ts` — fixture เดิมใช้ `localhost` (guard บล็อก) → single-label host

**รอบ 2 — rate-limit + helmet + ยืนยัน gzip**
- `package.json` — เพิ่ม `@nestjs/throttler` + `helmet`
- `src/config/env.ts` — `THROTTLE_TTL_MS` / `THROTTLE_LIMIT`
- `src/app.module.ts` — `ThrottlerModule.forRootAsync` + `APP_GUARD ThrottlerGuard`
- `src/crawl/crawl.controller.ts` — `@Throttle` เพดานเข้มบน `POST /crawls`
- `src/main.ts` — `helmet()` (CSP off เฉพาะ non-prod)
- `src/crawler/crawler.service.spec.ts` — regression test: ส่ง `maxContentLength` + ssrf agents + `beforeRedirect`
- `src/config/env.spec.ts` — test default ของ `THROTTLE_*`

ยืนยัน: `npm run build` ✓ · `npx jest` **265/265** ✓ · `eslint` ✓
e2e (`test:e2e`) ใช้ยืนยัน runtime boot ไม่ได้ — พังที่ compile บน ESM ของ `@langchain/langgraph`
(ปัญหา jest-e2e เดิม ไม่เกี่ยวกับ throttler/helmet ซึ่งเป็น CJS ทั้งคู่).
