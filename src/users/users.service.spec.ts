import { UsersService } from './users.service';
import { AppException, ErrorCode } from '../common/http';
import type { AuthUser } from '../auth/auth-user';

const makeRepo = () => ({
  list: jest.fn(),
  findById: jest.fn(),
  findByEmail: jest.fn(),
  create: jest.fn(),
  updateFields: jest.fn(),
  countActiveAdmins: jest.fn(),
});

const admin = (id: number): AuthUser => ({
  id,
  clerkUserId: `c${id}`,
  email: `a${id}@x.com`,
  role: 'admin',
});

const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppException);
  expect((err as AppException).code).toBe(code);
};

describe('UsersService', () => {
  it('list → ห่อ items', async () => {
    const repo = makeRepo();
    repo.list.mockResolvedValue([{ id: 1 }]);
    const svc = new UsersService(repo as never);
    await expect(svc.list()).resolves.toEqual({ items: [{ id: 1 }] });
  });

  it('getById ไม่เจอ → USER_NOT_FOUND', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new UsersService(repo as never);
    await expectCode(svc.getById(9), ErrorCode.USER_NOT_FOUND);
  });

  it('create email ซ้ำ → USER_EMAIL_EXISTS', async () => {
    const repo = makeRepo();
    repo.findByEmail.mockResolvedValue({ id: 1 });
    const svc = new UsersService(repo as never);
    await expectCode(
      svc.create({ email: 'dup@x.com', role: 'user' } as never),
      ErrorCode.USER_EMAIL_EXISTS,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('create ใหม่ → เรียก repo.create(email, role)', async () => {
    const repo = makeRepo();
    repo.findByEmail.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: 2 });
    const svc = new UsersService(repo as never);
    await svc.create({ email: 'new@x.com', role: 'user' } as never);
    expect(repo.create).toHaveBeenCalledWith('new@x.com', 'user');
  });

  it('disable user ธรรมดา → updateFields({status:disabled}) (ไม่เช็ค lockout)', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue({ id: 7, role: 'user', status: 'active' });
    repo.updateFields.mockResolvedValue({ id: 7 });
    const svc = new UsersService(repo as never);
    await svc.setStatus(7, 'disabled', admin(1));
    expect(repo.updateFields).toHaveBeenCalledWith(7, { status: 'disabled' });
    expect(repo.countActiveAdmins).not.toHaveBeenCalled();
  });

  it('disable admin คนสุดท้ายที่ active → CONFLICT', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue({ id: 5, role: 'admin', status: 'active' });
    repo.countActiveAdmins.mockResolvedValue(0);
    const svc = new UsersService(repo as never);
    await expectCode(
      svc.setStatus(5, 'disabled', admin(1)),
      ErrorCode.CONFLICT,
    );
    expect(repo.updateFields).not.toHaveBeenCalled();
  });

  it('actor ระงับ/ลดสิทธิ์ตัวเอง → CONFLICT (ก่อนนับ admin อื่น)', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue({ id: 1, role: 'admin', status: 'active' });
    const svc = new UsersService(repo as never);
    await expectCode(
      svc.setStatus(1, 'disabled', admin(1)),
      ErrorCode.CONFLICT,
    );
    expect(repo.countActiveAdmins).not.toHaveBeenCalled();
  });

  it('demote admin เมื่อยังมี admin อื่น active → ผ่าน', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue({ id: 5, role: 'admin', status: 'active' });
    repo.countActiveAdmins.mockResolvedValue(2);
    repo.updateFields.mockResolvedValue({ id: 5 });
    const svc = new UsersService(repo as never);
    await svc.update(5, { role: 'user' } as never, admin(1));
    expect(repo.updateFields).toHaveBeenCalledWith(5, { role: 'user' });
  });
});
