import { BASE_UNITS, FIELD_COST, estimateUnits } from './cost';

describe('estimateUnits (CostEstimator — เอกสาร 03 §4)', () => {
  it('คืน base เมื่อไม่มี field (rows clamp เป็น 1)', () => {
    expect(estimateUnits([], 0)).toBe(BASE_UNITS);
  });

  it('คิด cost ของ field ที่รู้จัก × rows', () => {
    // keyword(1)+difficulty(5)+traffic_potential(10) = 16/row ; rows=2 → 50 + 32
    const units = estimateUnits(
      ['keyword', 'difficulty', 'traffic_potential'],
      2,
    );
    expect(units).toBe(BASE_UNITS + 16 * 2);
  });

  it('field ที่ไม่อยู่ในแมพ = 1 unit', () => {
    expect(estimateUnits(['mystery_field'], 1)).toBe(BASE_UNITS + 1);
  });

  it('rows < 1 ถูก clamp เป็น 1 (อย่างน้อยจ่าย 1 แถว)', () => {
    expect(estimateUnits(['keyword'], 0)).toBe(BASE_UNITS + 1);
    expect(estimateUnits(['keyword'], -5)).toBe(BASE_UNITS + 1);
  });

  it('metric แพงตามเอกสาร (difficulty=5, traffic_potential=10)', () => {
    expect(FIELD_COST.difficulty).toBe(5);
    expect(FIELD_COST.traffic_potential).toBe(10);
    expect(BASE_UNITS).toBe(50);
  });
});
