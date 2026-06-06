/**
 * Analysis stage [3] — scoring "โค้ดล้วน" (เอกสาร 04 §7 / 01 §254,§266).
 *
 * ฟังก์ชัน pure ทั้งไฟล์ (ไม่มี I/O / DB) → unit test ง่าย และเป็นหัวใจของ Phase 1:
 *   - keywordCoverage : keyword หลักปรากฏใน title/url/h1/h2/para1 ครบไหม (0-100)
 *   - healthScore     : สุขภาพ on-page รวม (0-100, หักตามปัญหาที่ตรวจได้โดยไม่ใช้ AI)
 *   - detectFindings  : รายการ audit_findings (type ตาม enum auditFindings.type)
 *   - impactScore     : ลำดับความสำคัญ = severity × traffic (priority ของเอกสาร 01 §266)
 *
 * Phase 2 (เอกสาร 02): cannibalization/content_gap/AI = อยู่นอกไฟล์นี้.
 */

/** ระดับความรุนแรงของ finding (ตรง enum auditFindings.severity). */
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** น้ำหนัก severity สำหรับคำนวณ impact (low<med<high<crit). */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/* ---------- thresholds (named const — เลื่อนเป็น env ภายหลังได้) ---------- */
/** ช่วงความยาว title ที่เหมาะ (อักขระ) — สั้น/ยาวไปทั้งคู่เสีย SEO. */
export const TITLE_MIN = 10;
export const TITLE_MAX = 60;
/** เนื้อหาบาง (thin content) ถ้าน้อยกว่านี้ (คำ). */
export const THIN_CONTENT_WORDS = 300;
/** เพดาน Core Web Vitals (Google "needs improvement" boundary). */
export const LCP_SLOW_MS = 2500;
export const CLS_SLOW_X1000 = 100; // CLS 0.1 × 1000
export const INP_SLOW_MS = 200;
/** หักคะแนน health สูงสุดจากภาพไม่มี alt (สัดส่วนตามจำนวนที่ขาด). */
const MISSING_ALT_MAX_PENALTY = 15;

/** หัวข้อ (headings) ของ snapshot — ตรงรูป json ที่ crawler เก็บ. */
export interface Headings {
  h1: string[];
  h2: string[];
  h3: string[];
}

/**
 * มุมมองต่อ 1 หน้า ที่ scoring ต้องใช้ — runner ประกอบจาก page_snapshots + pages
 * + page_keywords/keywords (primaryKeyword/pageTraffic) + page_links (inbound).
 */
export interface SnapshotView {
  url: string;
  httpStatus: number;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  headings: Headings | null;
  /** ย่อหน้าจาก <p> (para1 = paragraphs[0]) — null ถ้า crawler ไม่ได้เก็บ. */
  paragraphs: string[] | null;
  wordCount: number;
  robotsMeta: string | null;
  isIndexable: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  lcpMs: number | null;
  clsX1000: number | null;
  inpMs: number | null;
  /** keyword ที่หน้านี้ติดอันดับดีสุด (min position) — null ถ้ายังไม่มี ranking. */
  primaryKeyword: string | null;
  /** traffic รวมของหน้า (Σ page_keywords.traffic) — ใช้ถ่วง impact. default 0. */
  pageTraffic: number;
  /** จำนวนลิงก์ภายในที่ "ชี้เข้า" หน้านี้ (resolve toPageId แล้ว) — 0 = orphan. */
  inboundInternalLinks: number;
}

/** ผล keyword coverage: 5 ช่อง × 20 = 0-100 (null ถ้าไม่มี primary keyword). */
export interface CoverageResult {
  score: number | null;
  breakdown: {
    keyword: string | null;
    title: boolean;
    url: boolean;
    h1: boolean;
    h2: boolean;
    intro: boolean;
  };
}

/** ผล health score + รายการหักคะแนน (ไว้แสดง breakdown ใน dashboard). */
export interface HealthResult {
  score: number;
  breakdown: { deductions: Array<{ reason: string; points: number }> };
}

/** finding ก่อนลง DB (runner เติม projectId/pageId/crawlId ตอน insert). */
export interface Finding {
  type: string;
  severity: Severity;
  impactScore: number;
  details: Record<string, unknown>;
}

/**
 * normalize ข้อความสำหรับเทียบ substring แบบหลวม: lowercase + ยุบ
 * space/`-`/`_`/`/` เป็นช่องว่างเดียว. ให้ keyword "best running shoes"
 * จับกับ slug "best-running-shoes" และ title ได้เหมือนกัน.
 * (ไม่ตัด accent/diacritic ∵ จะทำลายวรรณยุกต์/สระไทย ซึ่งเป็นภาษาหลักของระบบ)
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_/]+/g, ' ')
    .trim();
}

/** haystack มี needle ไหม (ทั้งคู่ normalize แล้ว); ค่าว่าง = ไม่พบ. */
function contains(
  haystack: string | null | undefined,
  needle: string,
): boolean {
  if (!haystack) return false;
  const n = norm(needle);
  return n.length > 0 && norm(haystack).includes(n);
}

/**
 * keyword coverage (เอกสาร 01 §254): primary keyword ปรากฏใน title/url/h1/h2/para1.
 * แต่ละช่อง 20 แต้ม → 0-100. ไม่มี primary keyword → score=null (วัดไม่ได้).
 */
export function keywordCoverage(view: SnapshotView): CoverageResult {
  const kw = view.primaryKeyword;
  if (!kw) {
    return {
      score: null,
      breakdown: {
        keyword: null,
        title: false,
        url: false,
        h1: false,
        h2: false,
        intro: false,
      },
    };
  }
  // url: decode ก่อน (slug มัก url-encode) — ทิ้ง error ถ้า decode ไม่ได้
  let urlText = view.url;
  try {
    urlText = decodeURIComponent(view.url);
  } catch {
    /* ใช้ค่าดิบ */
  }
  const intro = view.paragraphs?.[0] ?? null;
  const h2Hit = (view.headings?.h2 ?? []).some((h) => contains(h, kw));

  const flags = {
    keyword: kw,
    title: contains(view.title, kw),
    url: contains(urlText, kw),
    h1: contains(view.h1, kw),
    h2: h2Hit,
    intro: contains(intro, kw),
  };
  const hits = [flags.title, flags.url, flags.h1, flags.h2, flags.intro].filter(
    Boolean,
  ).length;
  return { score: hits * 20, breakdown: flags };
}

/** clamp ค่าให้อยู่ใน [min,max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * health score (เอกสาร 01 §255) — เริ่ม 100 หักตามปัญหา on-page ที่ตรวจได้โดยไม่ใช้ AI.
 * breakdown.deductions เก็บเหตุ+แต้มที่หัก เพื่อให้ dashboard อธิบายได้.
 */
export function healthScore(view: SnapshotView): HealthResult {
  const deductions: Array<{ reason: string; points: number }> = [];
  const cut = (reason: string, points: number) => {
    if (points > 0) deductions.push({ reason, points });
  };

  if (view.httpStatus >= 400) cut('http_error', 40);

  if (!view.title) cut('no_title', 10);
  else if (view.title.length < TITLE_MIN || view.title.length > TITLE_MAX)
    cut('title_len', 5);

  if (!view.metaDescription) cut('missing_meta', 5);

  if (!view.h1) cut('no_h1', 10);
  else if ((view.headings?.h1.length ?? 0) > 1) cut('multi_h1', 5);

  if (view.wordCount < THIN_CONTENT_WORDS) cut('thin_content', 10);

  if (view.imagesTotal > 0 && view.imagesMissingAlt > 0) {
    const ratio = view.imagesMissingAlt / view.imagesTotal;
    cut(
      'missing_alt',
      Math.max(1, Math.round(MISSING_ALT_MAX_PENALTY * ratio)),
    );
  }

  if (view.lcpMs != null && view.lcpMs > LCP_SLOW_MS) cut('slow_lcp', 10);
  if (view.clsX1000 != null && view.clsX1000 > CLS_SLOW_X1000)
    cut('slow_cls', 5);
  if (view.inpMs != null && view.inpMs > INP_SLOW_MS) cut('slow_inp', 5);

  if (isNoindex(view)) cut('noindex', 15);

  const total = deductions.reduce((s, d) => s + d.points, 0);
  return { score: clamp(100 - total, 0, 100), breakdown: { deductions } };
}

/** หน้านี้ถูกกันไม่ให้ index ไหม (meta robots noindex หรือ pages.is_indexable=false). */
function isNoindex(view: SnapshotView): boolean {
  return !view.isIndexable || /noindex/i.test(view.robotsMeta ?? '');
}

/** impact = severity × (1 + pageTraffic) (เอกสาร 01 §266 priority = business × traffic;
 *  business_potential ยังไม่มี column → default 1). */
export function impactScore(severity: Severity, pageTraffic: number): number {
  return SEVERITY_WEIGHT[severity] * (1 + Math.max(0, pageTraffic));
}

/**
 * detectFindings — สร้าง audit_findings ชนิด "โค้ดล้วน" จาก 1 หน้า (เอกสาร 04 §7).
 * type ตรงกับ enum ใน auditFindings.type. impactScore ถ่วงด้วย pageTraffic.
 */
export function detectFindings(view: SnapshotView): Finding[] {
  const out: Finding[] = [];
  const add = (
    type: string,
    severity: Severity,
    details: Record<string, unknown>,
  ) =>
    out.push({
      type,
      severity,
      impactScore: impactScore(severity, view.pageTraffic),
      details,
    });

  // http_error — หน้าพัง: 5xx=critical, 4xx=high
  if (view.httpStatus >= 400)
    add('http_error', view.httpStatus >= 500 ? 'critical' : 'high', {
      httpStatus: view.httpStatus,
    });

  // title — หาย (medium) หรือยาว/สั้นเกิน (low)
  if (!view.title)
    add('title_len', 'medium', { length: 0, min: TITLE_MIN, max: TITLE_MAX });
  else if (view.title.length < TITLE_MIN || view.title.length > TITLE_MAX)
    add('title_len', 'low', {
      length: view.title.length,
      min: TITLE_MIN,
      max: TITLE_MAX,
    });

  if (!view.metaDescription) add('missing_meta', 'low', {});

  if (!view.h1) add('no_h1', 'medium', {});
  else if ((view.headings?.h1.length ?? 0) > 1)
    add('multi_h1', 'low', { count: view.headings?.h1.length ?? 0 });

  if (view.wordCount < THIN_CONTENT_WORDS)
    add('thin_content', 'low', {
      wordCount: view.wordCount,
      threshold: THIN_CONTENT_WORDS,
    });

  if (view.imagesTotal > 0 && view.imagesMissingAlt > 0) {
    const ratio = view.imagesMissingAlt / view.imagesTotal;
    add('missing_alt', ratio >= 0.5 ? 'medium' : 'low', {
      imagesTotal: view.imagesTotal,
      imagesMissingAlt: view.imagesMissingAlt,
    });
  }

  if (view.lcpMs != null && view.lcpMs > LCP_SLOW_MS)
    add('slow_lcp', 'medium', { lcpMs: view.lcpMs, threshold: LCP_SLOW_MS });
  if (view.clsX1000 != null && view.clsX1000 > CLS_SLOW_X1000)
    add('slow_cls', 'low', {
      clsX1000: view.clsX1000,
      threshold: CLS_SLOW_X1000,
    });
  if (view.inpMs != null && view.inpMs > INP_SLOW_MS)
    add('slow_inp', 'low', { inpMs: view.inpMs, threshold: INP_SLOW_MS });

  if (isNoindex(view))
    add('noindex', 'medium', {
      robotsMeta: view.robotsMeta,
      isIndexable: view.isIndexable,
    });

  // orphan — หน้า rankable (indexable + http ok) แต่ไม่มีลิงก์ภายในชี้เข้า.
  // มี traffic = สำคัญกว่า (high) ไม่มี = medium. เอกสาร 04 §7 "orphan detector".
  if (
    !isNoindex(view) &&
    view.httpStatus < 400 &&
    view.inboundInternalLinks === 0
  )
    add('orphan', view.pageTraffic > 0 ? 'high' : 'medium', {
      inboundInternalLinks: 0,
    });

  return out;
}
