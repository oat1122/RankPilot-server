import { Global, Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepo } from './projects.repo';
import { ProjectAccessGuard } from './project-access.guard';

/**
 * ProjectsModule (@Global) — projects domain + ProjectAccessGuard ที่ domain อื่น
 * (crawls/trends/analysis/ai/enrich) reuse ผ่าน @UseGuards โดยไม่ต้อง import (รูปเดียวกับ DbModule).
 */
@Global()
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepo, ProjectAccessGuard],
  exports: [ProjectsService, ProjectAccessGuard],
})
export class ProjectsModule {}
