import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/http';
import { ProjectsRepo } from './projects.repo';
import type { CreateProjectDto } from './dto/create-project.dto';

/**
 * ProjectsService — บาง (เอกสาร 00 §4): delegate repo. read/write เบา (ไม่ใช่งานหนักที่ต้อง
 * enqueue) จึงรันใน request thread ได้. ทุก op scope ด้วย userId (multi-tenant — เอกสาร 05 §4).
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly repo: ProjectsRepo) {}

  async listForUser(userId: number) {
    const items = await this.repo.listByOwner(userId);
    return { items };
  }

  create(userId: number, dto: CreateProjectDto) {
    return this.repo.create(userId, dto);
  }

  /** detail ที่ scope เจ้าของ — ไม่เจอ/ไม่ใช่เจ้าของ → 404 (กัน enumeration ข้าม tenant). */
  async getOwned(projectId: number, userId: number) {
    const project = await this.repo.findOwned(projectId, userId);
    if (!project)
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `project ${projectId} not found`,
      );
    return project;
  }
}
