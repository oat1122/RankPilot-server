import { EmbeddingService } from './embedding.service';

/** ทดสอบเฉพาะ buildText (pure) — ส่วน DB/Voyage ทดสอบตอน integration (live, เอกสาร 02 Phase 6). */
function svc(): EmbeddingService {
  return new EmbeddingService(
    {} as never, // db — ไม่ถูกเรียกใน buildText
    {} as never, // voyage
    {} as never, // config
  );
}

describe('EmbeddingService.buildText', () => {
  it('รวม title + h1 + h2/h3 + ย่อหน้า เป็นข้อความเดียว', () => {
    const t = svc().buildText({
      title: 'รองเท้าวิ่งดีที่สุด 2026',
      h1: 'รีวิวรองเท้าวิ่ง',
      headings: { h1: [], h2: ['การเลือกไซส์', 'ราคา'], h3: ['แบรนด์'] },
      paragraphs: ['ย่อหน้าแรกของเนื้อหา'],
    });
    expect(t).toContain('รองเท้าวิ่งดีที่สุด 2026');
    expect(t).toContain('รีวิวรองเท้าวิ่ง');
    expect(t).toContain('การเลือกไซส์ · ราคา · แบรนด์');
    expect(t).toContain('ย่อหน้าแรกของเนื้อหา');
  });

  it('ไม่ซ้ำ h1 เมื่อ h1 == title', () => {
    const t = svc().buildText({
      title: 'หัวข้อ',
      h1: 'หัวข้อ',
      headings: null,
      paragraphs: null,
    });
    expect(t).toBe('หัวข้อ');
  });

  it('ตัดความยาวไม่เกิน 8000 ตัวอักษร', () => {
    const long = 'ก'.repeat(20000);
    const t = svc().buildText({
      title: null,
      h1: null,
      headings: null,
      paragraphs: [long],
    });
    expect(t.length).toBeLessThanOrEqual(8000);
  });

  it('ฟิลด์ว่างทั้งหมด → ""', () => {
    const t = svc().buildText({
      title: null,
      h1: null,
      headings: null,
      paragraphs: null,
    });
    expect(t).toBe('');
  });
});
