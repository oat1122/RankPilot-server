/**
 * แกะ array ของ rows จาก response Ahrefs API v3 — รองรับทั้ง array ตรง ๆ และรูปที่ v3
 * ห่อใน object (เช่น `{ keywords: [...] }`): หยิบ property แรกที่เป็น array.
 *
 * ใช้ "ร่วมกัน" ระหว่าง AhrefsClient (นับ rows ลง cache/usage) และ EnrichmentService
 * (map เป็น keyword) เพื่อให้ทั้งสองฝั่งเห็นจำนวน/ชุดแถวตรงกันเสมอ (กัน rows ≠ fetched).
 * กรองเฉพาะ element ที่เป็น object (แถวข้อมูลจริง) ทิ้ง null/primitive.
 */
export function extractRowArray(data: unknown): Record<string, unknown>[] {
  let arr: unknown = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        arr = v;
        break;
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object',
  );
}
