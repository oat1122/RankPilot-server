import { validateEnv } from './env';

// env ถูก validate fail-fast ที่ boot (เอกสาร 04 §5) — ค่าผิดต้องล้มพร้อมข้อความชัด
describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'mysql://root:dev@localhost:3306/rankpilot',
  };

  it('ค่า default ของ CRAWLER_* coerce ถูกชนิด', () => {
    const env = validateEnv({ ...base });
    expect(env.CRAWLER_TIMEOUT_MS).toBe(15000);
    expect(env.CRAWLER_MAX_BYTES).toBe(5_000_000);
    expect(env.CRAWLER_MAX_REDIRECTS).toBe(5);
    expect(typeof env.CRAWLER_USER_AGENT).toBe('string');
  });

  it('coerce ตัวเลขจาก string env', () => {
    const env = validateEnv({
      ...base,
      CRAWLER_TIMEOUT_MS: '8000',
      PORT: '4000',
    });
    expect(env.CRAWLER_TIMEOUT_MS).toBe(8000);
    expect(env.PORT).toBe(4000);
  });

  describe('REDIS_URL', () => {
    it('รับ redis:// และ rediss://', () => {
      expect(() =>
        validateEnv({ ...base, REDIS_URL: 'redis://h:6379' }),
      ).not.toThrow();
      expect(() =>
        validateEnv({ ...base, REDIS_URL: 'rediss://h:6380' }),
      ).not.toThrow();
    });

    it('ปฏิเสธค่าที่ไม่ใช่ redis URL (fail-fast แทน crash ตอน BullMQ init)', () => {
      // ก่อนแก้: ค่าพวกนี้ผ่าน min(1) แล้วไป throw แบบ cryptic ที่ new URL ใน parseRedisUrl
      expect(() =>
        validateEnv({ ...base, REDIS_URL: 'not a url at all' }),
      ).toThrow(/REDIS_URL/);
      expect(() =>
        validateEnv({ ...base, REDIS_URL: 'localhost:6379' }),
      ).toThrow(/REDIS_URL/);
    });

    it('ปฏิเสธเมื่อ REDIS_URL หาย', () => {
      expect(() => validateEnv({ NODE_ENV: 'test' })).toThrow(/REDIS_URL/);
    });
  });

  describe('DATABASE_URL', () => {
    it('รับ mysql:// (MariaDB ผ่าน mysql2)', () => {
      expect(() =>
        validateEnv({
          ...base,
          DATABASE_URL: 'mysql://root:dev@localhost:3306/rankpilot',
        }),
      ).not.toThrow();
    });

    it('ปฏิเสธ scheme ที่ไม่ใช่ mysql:// (fail-fast แทน crash ตอน createPool)', () => {
      expect(() =>
        validateEnv({ ...base, DATABASE_URL: 'postgres://h:5432/db' }),
      ).toThrow(/DATABASE_URL/);
      expect(() =>
        validateEnv({ ...base, DATABASE_URL: 'localhost:3306' }),
      ).toThrow(/DATABASE_URL/);
    });

    it('ปฏิเสธเมื่อ DATABASE_URL หาย', () => {
      const noDb = { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' };
      expect(() => validateEnv(noDb)).toThrow(/DATABASE_URL/);
    });
  });
});
