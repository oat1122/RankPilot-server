import { z } from 'zod';
import type { AIMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';

/**
 * โครงสร้าง "คำแนะนำ SEO" ของรายงานเว็บเต็ม (apnth.com template §ANALYSIS) — บังคับ structured
 * output (json_schema strict) ให้ LLM คืนเป็น array/string ตรง schema (ไม่ใช่ free text). ภาษาไทย.
 */
export const SiteAnalysisSchema = z.object({
  strengths: z.array(z.string()).max(8), // จุดแข็ง
  weaknesses: z.array(z.string()).max(8), // จุดอ่อน
  recommendations: z.array(z.string()).max(10), // คำแนะนำ (action items)
  timeline: z.string(), // ระยะเวลา/แผนที่ควรทำ SEO + คาดการณ์ผล
});
export type SiteAnalysis = z.infer<typeof SiteAnalysisSchema>;

/** 1 keyword ที่เว็บ rank (ป้อนให้ LLM ดูบริบท). */
export interface AnalysisKeyword {
  keyword: string;
  position: number | null;
  volume: number | null;
}

/** บริบท metric ทั้งหมดที่ป้อนให้ LLM วิเคราะห์ (จาก Ahrefs + WHOIS + crawler). */
export interface SiteMetricsContext {
  domain: string;
  country: string;
  registrar: string | null;
  ageYears: number | null;
  metaDescription: string | null;
  domainRating: number | null;
  urlRating: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  refdomainsNew: number | null;
  refdomainsLost: number | null;
  spamScore: number | null;
  aiMentions: number | null;
  organicTraffic: number;
  organicValue: number;
  organicKeywords: number;
  competitors: string[];
  topKeywords: AnalysisKeyword[];
}

/** โหมด structured output (json_schema strict) + includeRaw เพื่ออ่าน token usage (เอกสาร 02 §2). */
const so = { method: 'jsonSchema', strict: true, includeRaw: true } as const;

const f = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US');

/** prompt ภาษาไทย — ป้อน metric ทั้งหมด ขอ จุดแข็ง/จุดอ่อน/คำแนะนำ/timeline. */
export function buildPrompt(ctx: SiteMetricsContext, skills: string): string {
  const kw = ctx.topKeywords
    .slice(0, 25)
    .map(
      (k) =>
        `- ${k.keyword} (อันดับ ${k.position ?? '—'}, volume ${f(k.volume)})`,
    )
    .join('\n');
  const prefix = skills ? `${skills}\n\n` : '';
  return `${prefix}คุณเป็นที่ปรึกษา SEO มืออาชีพ วิเคราะห์ภาพรวมเว็บไซต์จากข้อมูล Ahrefs/WHOIS ด้านล่าง แล้วสรุปเป็นภาษาไทย

โดเมน: ${ctx.domain} (ประเทศเป้าหมาย: ${ctx.country})
Registrar: ${ctx.registrar ?? '—'}
อายุโดเมน: ${ctx.ageYears != null ? `${ctx.ageYears} ปี` : '—'}
คำอธิบายเว็บ (meta): ${ctx.metaDescription ?? '—'}

— Authority —
DR (Domain Rating): ${f(ctx.domainRating)}
UR (URL Rating ≈ Trust): ${f(ctx.urlRating)}
Backlinks (BL): ${f(ctx.backlinks)}
Referring domains: ${f(ctx.referringDomains)}
Ref domains ใหม่/หาย ล่าสุด: +${f(ctx.refdomainsNew)} / -${f(ctx.refdomainsLost)}
Spam score (ประมาณการ): ${ctx.spamScore != null ? `${ctx.spamScore}%` : '—'}
AI mentions: ${f(ctx.aiMentions)}

— Organic —
Organic traffic/เดือน: ${f(ctx.organicTraffic)}
มูลค่า traffic: $${f(ctx.organicValue)}
จำนวน keyword ที่ติดอันดับ: ${f(ctx.organicKeywords)}
คู่แข่ง: ${ctx.competitors.slice(0, 10).join(', ') || '—'}

— Keyword ที่ติดอันดับ (บางส่วน) —
${kw || '— (ยังไม่มีข้อมูล)'}

จงประเมินตามจริง อิงตัวเลขข้างต้น:
- strengths: จุดแข็งของเว็บ (เช่น DR สูง, ref domains เยอะ, keyword ติดเยอะ) — ถ้าตัวเลขอ่อนทุกด้านให้ระบุตรง ๆ
- weaknesses: จุดอ่อน/ความเสี่ยง (เช่น DR ต่ำ, spam สูง, traffic น้อย, keyword น้อย)
- recommendations: คำแนะนำที่ลงมือทำได้จริง เรียงตามความสำคัญ (on-page, content, backlink, technical)
- timeline: ระยะเวลาที่ควรลงมือทำ SEO + คาดการณ์ผลตามความเป็นจริง (เช่น 3-6 เดือนเห็นผลกับ keyword long-tail) และเมื่อไรควรพิจารณา Google Ads เสริมระหว่างรอ organic`;
}

/** ดึง token usage จาก raw AIMessage (จาก includeRaw) — normalize เป็น {in,out}. */
function usageOf(raw: AIMessage): { tokensIn: number; tokensOut: number } {
  const u = raw.usage_metadata;
  return {
    tokensIn: Number(u?.input_tokens ?? 0),
    tokensOut: Number(u?.output_tokens ?? 0),
  };
}

/**
 * รัน LLM (structured output) → คืน analysis + token usage. llm/skills เตรียมจากภายนอก (runner)
 * เหมือน graph prep ของ page_audit (model ต่อโปรเจค + ai_skills รายโหนด 'site_report').
 */
export async function analyzeSite(
  llm: ChatOpenAI,
  ctx: SiteMetricsContext,
  skills: string,
): Promise<{ analysis: SiteAnalysis; tokensIn: number; tokensOut: number }> {
  const r = await llm
    .withStructuredOutput(SiteAnalysisSchema, so)
    .invoke(buildPrompt(ctx, skills));
  return { analysis: r.parsed, ...usageOf(r.raw as AIMessage) };
}
