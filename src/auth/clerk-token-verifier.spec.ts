import { verifyToken } from '@clerk/backend';
import { ClerkTokenVerifier } from './clerk-token-verifier';
import { AppException, ErrorCode } from '../common/http';

// mock @clerk/backend: `verifyToken` (withLegacyReturn) คืน JwtPayload (claims) ตรง ๆ และ throw
// ทุกกรณีที่ verify ไม่ผ่าน — mock ให้สะท้อนสัญญานี้ (ไม่ใช่ { data, errors } แบบเก่า).
jest.mock('@clerk/backend', () => ({ verifyToken: jest.fn() }));
const verifyTokenMock = verifyToken as jest.MockedFunction<typeof verifyToken>;

function makeVerifier(config: Record<string, string> = {}) {
  const configService = { get: jest.fn((k: string) => config[k]) };
  return new ClerkTokenVerifier(configService as never);
}

describe('ClerkTokenVerifier', () => {
  beforeEach(() => verifyTokenMock.mockReset());

  it('verifyToken throw (หมดอายุ/ลายเซ็น/รูปแบบพัง) → AppException 401 (ไม่หลุดเป็น 500)', async () => {
    verifyTokenMock.mockRejectedValue(new Error('JWT is expired'));
    const verifier = makeVerifier({ CLERK_SECRET_KEY: 'sk' });
    await expect(verifier.verify('tok')).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
    await expect(verifier.verify('tok')).rejects.toBeInstanceOf(AppException);
  });

  it('token รูปแบบพัง (Invalid JWT form) → AppException 401', async () => {
    verifyTokenMock.mockRejectedValue(
      new Error('Invalid JWT form. A JWT consists of three parts.'),
    );
    const verifier = makeVerifier({ CLERK_SECRET_KEY: 'sk' });
    await expect(verifier.verify('not.a.real.jwt')).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it('claims ไม่มี sub → AppException 401', async () => {
    verifyTokenMock.mockResolvedValue({ email: 'a@b.com' } as never);
    const verifier = makeVerifier({ CLERK_SECRET_KEY: 'sk' });
    await expect(verifier.verify('tok')).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it('token ถูกต้อง → { clerkUserId, email } (claims อ่านตรงจาก payload)', async () => {
    verifyTokenMock.mockResolvedValue({
      sub: 'user_42',
      email: 'a@b.com',
    } as never);
    const verifier = makeVerifier({ CLERK_SECRET_KEY: 'sk' });
    await expect(verifier.verify('tok')).resolves.toEqual({
      clerkUserId: 'user_42',
      email: 'a@b.com',
    });
  });

  it('token ถูกต้องแต่ไม่มี email claim → email = null', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'user_42' } as never);
    const verifier = makeVerifier({ CLERK_SECRET_KEY: 'sk' });
    await expect(verifier.verify('tok')).resolves.toEqual({
      clerkUserId: 'user_42',
      email: null,
    });
  });

  it('CLERK_AUTHORIZED_PARTIES (comma-sep) → ส่ง azp allowlist เข้า verifyToken', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'u1' } as never);
    const verifier = makeVerifier({
      CLERK_SECRET_KEY: 'sk',
      CLERK_AUTHORIZED_PARTIES: 'http://localhost:3000, https://app.rankpilot',
    });
    await verifier.verify('tok');
    expect(verifyTokenMock).toHaveBeenCalledWith('tok', {
      secretKey: 'sk',
      authorizedParties: ['http://localhost:3000', 'https://app.rankpilot'],
    });
  });
});
