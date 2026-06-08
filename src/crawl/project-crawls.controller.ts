import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { ProjectAccessGuard } from '../projects/project-access.guard';
import { ListCrawlsQueryDto } from './dto/list-crawls.dto';
import { CrawlListDto } from './dto/crawl-list.dto';
import { CrawlsReadRepo } from './crawls-read.repo';

/**
 * /projects/:projectId/crawls — list ประวัติ crawl ของ project (เอกสาร 01 §2). read-only:
 * write (createCrawl/persistPage) ทำที่ worker. ProjectAccessGuard เช็คเจ้าของ (multi-tenant,
 * เอกสาร 05 §4). ไม่ชนกับ GET /crawls/:id (job status by BullMQ jobId) เพราะ nested ใต้ projects/.
 */
@ApiTags('crawl')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/crawls')
export class ProjectCrawlsController {
  constructor(private readonly repo: CrawlsReadRepo) {}

  @Get()
  @ApiEnvelopeResponse(CrawlListDto, {
    description:
      'ประวัติ crawl ของ project เรียงล่าสุดก่อน + total (KPI จำนวน Crawl)',
  })
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListCrawlsQueryDto,
  ) {
    return this.repo.listByProject(projectId, {
      limit: query.limit,
      offset: query.offset,
      status: query.status,
    });
  }
}
