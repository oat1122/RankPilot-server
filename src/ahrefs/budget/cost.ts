/**
 * CostEstimator (เอกสาร 03 §0/§4) — ประเมิน units ก่อนยิง Ahrefs.
 *
 *   units/request = BASE(50) + Σ(cost ของแต่ละ field ใน select) × rows
 *   field ปกติ = 1 unit, บาง metric (difficulty/url_rating/referring_domains) = 5,
 *   traffic_potential = 10. ใช้กัน select กว้างเกินจำเป็น (เอกสาร 03 §7 "select แคบ").
 *
 * เป็น pure function (ไม่มี state/IO) → ทดสอบได้ตรง ๆ.
 */
export const BASE_UNITS = 50;

/** ต้นทุนต่อ field (ปรับตาม docs Ahrefs จริงได้) — field ที่ไม่อยู่ในแมพ = 1 unit. */
export const FIELD_COST: Record<string, number> = {
  keyword: 1,
  volume: 1,
  cpc: 1,
  position: 1,
  best_position: 1,
  traffic: 1,
  sum_traffic: 1,
  traffic_value: 1,
  difficulty: 5, // Keywords Explorer column name
  keyword_difficulty: 5, // Site Explorer column name (organic-keywords)
  url_rating: 5,
  referring_domains: 5,
  traffic_potential: 10,
};

/** ประเมิน units ของ 1 request จาก field ที่เลือก × จำนวน rows ที่คาด. */
export function estimateUnits(fields: string[], rows: number): number {
  const perRow = fields.reduce((sum, f) => sum + (FIELD_COST[f] ?? 1), 0);
  return BASE_UNITS + perRow * Math.max(rows, 1);
}
