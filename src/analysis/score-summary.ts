/**
 * สรุปคะแนนระดับโปรเจค (gap #4) — เดิม FE derive avg เอง ∵ ไม่มี aggregate ฝั่ง server.
 * pure → unit test ได้ (service โหลด rows ผ่าน repo.listScores แล้วเรียกอันนี้).
 * avg เฉพาะค่าที่ไม่ใช่ null, ปัดเป็นจำนวนเต็ม; ไม่มีค่าเลย → null. pagesScored = จำนวน seo_scores row.
 */

export interface ScoreSummary {
  avgHealthScore: number | null;
  avgKeywordCoverage: number | null;
  pagesScored: number;
}

type ScoreRow = {
  healthScore: number | null;
  keywordCoverage: number | null;
};

function avgRounded(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

export function summarizeScores(rows: ScoreRow[]): ScoreSummary {
  const health = rows
    .map((r) => r.healthScore)
    .filter((v): v is number => v != null);
  const coverage = rows
    .map((r) => r.keywordCoverage)
    .filter((v): v is number => v != null);
  return {
    avgHealthScore: avgRounded(health),
    avgKeywordCoverage: avgRounded(coverage),
    pagesScored: rows.length,
  };
}
