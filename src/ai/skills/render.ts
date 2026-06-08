/**
 * Skills — ฉีดความรู้รายโหนด (เอกสาร 02 §4 / Phase 5). Skill = instruction (markdown) ที่ AI
 * "อ่าน" ก่อนตอบ. resolve (DB query) อยู่ใน AiConfigRepo; ที่นี่เก็บ pure helpers (render/filter)
 * → unit test ได้ และ prompt builders (prompts.ts) วาง skills เป็น prefix บนสุดของ system message.
 */

export interface Skill {
  slug: string;
  name: string;
  description: string;
  body: string;
  appliesTo: string[]; // ['diagnose','draft'] หรือ ['*'] = ทุกโหนด
  priority: number; // มากก่อน (บนสุดของ prefix)
}

/** skill นี้ apply กับ node นี้ไหม — '*' = ทุกโหนด (pure → ใช้ filter ใน repo/test). */
export function appliesToNode(appliesTo: string[], node: string): boolean {
  return appliesTo.includes('*') || appliesTo.includes(node);
}

/**
 * รวม body ของ skill เป็นบล็อกเดียววางบนสุดของ system prompt (cached prefix — เอกสาร 02 §4/§7).
 * input ควรเรียง priority desc มาแล้ว (จาก resolveSkillsForNode). ว่าง → '' (sys() จะข้าม).
 */
export function renderSkills(skills: Skill[]): string {
  if (!skills.length) return '';
  return [
    '## SKILLS — อ่านและปฏิบัติตามอย่างเคร่งครัดก่อนตอบ',
    ...skills.map((s) => `### ${s.name}\n${s.body.trim()}`),
  ].join('\n\n');
}
