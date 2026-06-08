import { ProjectsService } from './projects.service';
import { AppException } from '../common/http';

// ProjectsService บาง — ยืนยันว่า scope ด้วย userId + แปลง not-found เป็น PROJECT_NOT_FOUND.
// repo เป็น plain literal ของ jest.fn() (ไม่ใช่ typed class) → expect(repo.x) ไม่ติด unbound-method.
describe('ProjectsService', () => {
  const makeRepo = () => ({
    listByOwner: jest.fn(),
    create: jest.fn(),
    findOwned: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  });

  it('listForUser → ห่อ items + ส่ง ownerId', async () => {
    const repo = makeRepo();
    repo.listByOwner.mockResolvedValue([{ id: 1 }] as never);
    const svc = new ProjectsService(repo as never);
    await expect(svc.listForUser(7)).resolves.toEqual({ items: [{ id: 1 }] });
    expect(repo.listByOwner).toHaveBeenCalledWith(7);
  });

  it('create → delegate repo ด้วย ownerId', async () => {
    const repo = makeRepo();
    const dto = { name: 'A', domain: 'a.com', country: 'th' };
    repo.create.mockResolvedValue({ id: 2, ...dto });
    const svc = new ProjectsService(repo as never);
    await expect(svc.create(7, dto as never)).resolves.toMatchObject({ id: 2 });
    expect(repo.create).toHaveBeenCalledWith(7, dto);
  });

  it('getOwned ไม่เจอ → PROJECT_NOT_FOUND', async () => {
    const repo = makeRepo();
    repo.findOwned.mockResolvedValue(null);
    const svc = new ProjectsService(repo as never);
    await expect(svc.getOwned(9, 7)).rejects.toBeInstanceOf(AppException);
  });

  it('getOwned เจอ → คืน project', async () => {
    const repo = makeRepo();
    repo.findOwned.mockResolvedValue({ id: 9 });
    const svc = new ProjectsService(repo as never);
    await expect(svc.getOwned(9, 7)).resolves.toEqual({ id: 9 });
    expect(repo.findOwned).toHaveBeenCalledWith(9, 7);
  });

  it('update เจอ → คืน project ที่แก้แล้ว + ส่ง projectId/ownerId/dto', async () => {
    const repo = makeRepo();
    const dto = { name: 'B' };
    repo.update.mockResolvedValue({ id: 9, name: 'B' });
    const svc = new ProjectsService(repo as never);
    await expect(svc.update(7, 9, dto as never)).resolves.toMatchObject({
      name: 'B',
    });
    expect(repo.update).toHaveBeenCalledWith(9, 7, dto);
  });

  it('update ไม่ใช่เจ้าของ/ไม่เจอ (repo คืน null) → PROJECT_NOT_FOUND', async () => {
    const repo = makeRepo();
    repo.update.mockResolvedValue(null);
    const svc = new ProjectsService(repo as never);
    await expect(svc.update(7, 9, { name: 'B' })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('remove เจอ → ลบ + คืน resource ที่ถูกลบ', async () => {
    const repo = makeRepo();
    repo.findOwned.mockResolvedValue({ id: 9 });
    repo.remove.mockResolvedValue(undefined);
    const svc = new ProjectsService(repo as never);
    await expect(svc.remove(7, 9)).resolves.toEqual({ id: 9 });
    expect(repo.remove).toHaveBeenCalledWith(9, 7);
  });

  it('remove ไม่เจอ → PROJECT_NOT_FOUND (ไม่เรียก repo.remove)', async () => {
    const repo = makeRepo();
    repo.findOwned.mockResolvedValue(null);
    const svc = new ProjectsService(repo as never);
    await expect(svc.remove(7, 9)).rejects.toBeInstanceOf(AppException);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
