import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { projects } from '../db/schema';
import type { CreateProjectDto } from './dto/create-project.dto';

/** projection ของ project ที่ส่งออก API (ตรงกับ projectSchema). */
const projectCols = {
  id: projects.id,
  name: projects.name,
  domain: projects.domain,
  country: projects.country,
  monthlyUnitBudget: projects.monthlyUnitBudget,
  createdAt: projects.createdAt,
};

/**
 * ProjectsRepo — read/write projects (เอกสาร 01 §2). inject DB token (@Global). ทุก query
 * scope ด้วย ownerId เพื่อ multi-tenant (เอกสาร 05 §4) — ไม่มี endpoint ไหนอ่าน project ข้าม owner.
 */
@Injectable()
export class ProjectsRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** projects ของ owner เรียงล่าสุดก่อน (ใช้ ix_projects_owner). */
  listByOwner(ownerId: number) {
    return this.db
      .select(projectCols)
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .orderBy(desc(projects.createdAt));
  }

  /** 1 project ที่ owner เป็นเจ้าของ — null ถ้าไม่มี/ไม่ใช่เจ้าของ. */
  async findOwned(projectId: number, ownerId: number) {
    const rows = await this.db
      .select(projectCols)
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** สร้าง project ใหม่ของ owner → คืน row ที่สร้าง (country มี default จาก DTO/schema). */
  async create(ownerId: number, dto: CreateProjectDto) {
    const [{ id }] = await this.db
      .insert(projects)
      .values({
        ownerId,
        name: dto.name,
        domain: dto.domain,
        country: dto.country,
      })
      .$returningId();
    const created = await this.findOwned(id, ownerId);
    return created;
  }
}
