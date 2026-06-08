import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/http';
import { ProjectsRepo } from './projects.repo';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

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

  /** แก้ project ที่ scope เจ้าของ — ไม่ใช่เจ้าของ/ไม่เจอ → repo.update คืน null → 404. */
  async update(userId: number, projectId: number, dto: UpdateProjectDto) {
    const updated = await this.repo.update(projectId, userId, dto);
    if (!updated)
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `project ${projectId} not found`,
      );
    return updated;
  }

  /**
   * ลบ project (+ ลูกทั้งหมด — cascade ใน repo). ตรวจ ownership ก่อนเพื่อ 404 ที่ถูกต้อง
   * แล้วคืน resource ที่ถูกลบ (ProjectDto). ไม่เจอ/ไม่ใช่เจ้าของ → PROJECT_NOT_FOUND.
   */
  async remove(userId: number, projectId: number) {
    const project = await this.repo.findOwned(projectId, userId);
    if (!project)
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `project ${projectId} not found`,
      );
    await this.repo.remove(projectId, userId);
    return project;
  }
}
