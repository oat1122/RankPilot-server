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
import { ListPagesQueryDto, PageListDto } from './dto/list-pages.dto';
import { PageDetailDto } from './dto/page-response.dto';
import { PagesService } from './pages.service';

/**
 * /projects/:projectId/pages — list หน้าที่ crawl มา + รายละเอียดรายหน้า (page detail).
 * read-only (write ที่ worker). ProjectAccessGuard เช็คเจ้าของ (multi-tenant — เอกสาร 05 §4).
 * route literal ไม่มี → :pageId param ตรง ๆ ไม่ชน.
 */
@ApiTags('pages')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/pages')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  @ApiEnvelopeResponse(PageListDto, {
    description:
      'หน้าทั้งหมดของ crawl ที่เลือก/ล่าสุด + คะแนน (sort by url) + total (pagination)',
  })
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListPagesQueryDto,
  ) {
    return this.pages.list(projectId, {
      crawlId: query.crawlId,
      limit: query.limit,
      offset: query.offset,
      search: query.search,
    });
  }

  @Get(':pageId')
  @ApiEnvelopeResponse(PageDetailDto, {
    description:
      'รายละเอียดหน้าเดียว: on-page + score + ranking(Ahrefs) + links + images + findings',
  })
  detail(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('pageId', ParseIntPipe) pageId: number,
  ) {
    return this.pages.detail(projectId, pageId);
  }
}
