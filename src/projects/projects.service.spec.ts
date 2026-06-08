import { ProjectsService } from './projects.service';
import { AppException } from '../common/http';

// ProjectsService บาง — ยืนยันว่า scope ด้วย userId + แปลง not-found เป็น PROJECT_NOT_FOUND.
// repo เป็น plain literal ของ jest.fn() (ไม่ใช่ typed class) → expect(repo.x) ไม่ติด unbound-method.
describe('ProjectsService', () => {
  const makeRepo = () => ({
    listByOwner: jest.fn(),
    create: jest.fn(),
    findOwned: jest.fn(),
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
});
