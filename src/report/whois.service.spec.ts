import { of, throwError } from 'rxjs';
import { WhoisService } from './whois.service';

type HttpArg = ConstructorParameters<typeof WhoisService>[0];
type ConfigArg = ConstructorParameters<typeof WhoisService>[1];

/** RDAP response จริง (apnth.com style): registrar ใน entities + วันจดใน events. */
const RDAP_FIXTURE = {
  entities: [
    {
      roles: ['registrar'],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Squarespace Domains II LLC'],
        ],
      ],
    },
  ],
  events: [
    { eventAction: 'registration', eventDate: '2019-03-15T00:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-03-15T00:00:00Z' },
  ],
};

function makeService(getImpl: () => unknown) {
  const http = { get: jest.fn(getImpl) };
  const config = { get: jest.fn().mockReturnValue('https://rdap.org') };
  const svc = new WhoisService(
    http as unknown as HttpArg,
    config as unknown as ConfigArg,
  );
  return { svc, http };
}

describe('WhoisService (RDAP)', () => {
  it('parse registrar + วันจดทะเบียนจาก RDAP', async () => {
    const { svc } = makeService(() => of({ data: RDAP_FIXTURE }));
    const r = await svc.lookup('apnth.com');
    expect(r.registrar).toBe('Squarespace Domains II LLC');
    expect(r.createdAt?.getUTCFullYear()).toBe(2019);
  });

  it('ตัด scheme/www/path ออกจาก domain ก่อนยิง RDAP', async () => {
    const { svc, http } = makeService(() => of({ data: RDAP_FIXTURE }));
    await svc.lookup('https://www.apnth.com/path');
    expect(http.get).toHaveBeenCalledWith(
      'https://rdap.org/domain/apnth.com',
      expect.anything(),
    );
  });

  it('error (404/timeout) → คืน null ทั้งคู่ (best-effort, ไม่ throw)', async () => {
    const { svc } = makeService(() => throwError(() => new Error('404')));
    const r = await svc.lookup('nope.invalid');
    expect(r).toEqual({ registrar: null, createdAt: null });
  });

  it('domain ว่าง → คืน null โดยไม่ยิง http', async () => {
    const { svc, http } = makeService(() => of({ data: {} }));
    const r = await svc.lookup('');
    expect(r).toEqual({ registrar: null, createdAt: null });
    expect(http.get).not.toHaveBeenCalled();
  });

  it('RDAP ไม่มี entities/events (TLD ไม่รองรับ) → null ทั้งคู่', async () => {
    const { svc } = makeService(() => of({ data: {} }));
    const r = await svc.lookup('example.th');
    expect(r).toEqual({ registrar: null, createdAt: null });
  });
});
