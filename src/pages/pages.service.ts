import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/http';
import { PagesRepo } from './pages.repo';
import type { ListPagesOptions } from './pages.repo';

/**
 * PagesService — บาง (เอกสาร 00 §4): delegate repo. read เบา (รันใน request thread ได้).
 * scope ด้วย projectId (ProjectAccessGuard เช็คเจ้าของแล้ว); detail ไม่พบ/ข้าม tenant → 404.
 */
@Injectable()
export class PagesService {
  constructor(private readonly repo: PagesRepo) {}

  list(projectId: number, opts: ListPagesOptions) {
    return this.repo.listByProject(projectId, opts);
  }

  async detail(projectId: number, pageId: number) {
    const detail = await this.repo.getDetail(projectId, pageId);
    if (!detail)
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `page ${pageId} not found in project ${projectId}`,
      );
    return detail;
  }
}
