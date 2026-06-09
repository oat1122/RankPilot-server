import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { ProjectAccessGuard } from '../projects/project-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { ReportService } from './report.service';
import {
  ReportEnqueuedDto,
  ReportStatusDto,
  SiteReportDto,
} from './dto/report-response.dto';

/**
 * /projects/:projectId/ahrefs/{site-report,report,report-status} — รายงานเว็บเต็ม (apnth.com
 * template). แยก controller จาก EnrichController (path prefix เดียวกัน route ต่างกัน → ไม่ชน)
 * เพื่อคุมความซับซ้อน. ProjectAccessGuard (@Global) multi-tenant. envelope/error ผ่านชั้นกลาง.
 */
@ApiTags('report')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/ahrefs')
export class ReportController {
  constructor(private readonly report: ReportService) {}

  @Post('site-report')
  @ApiEnvelopeResponse(ReportEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิวสร้างรายงานเว็บเต็ม — Ahrefs (DR/BL/refdomains/competitors) + WHOIS + meta + AI analysis (api แค่ enqueue)',
  })
  generate(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.report.enqueue(projectId, user.id);
  }

  @Get('report')
  @ApiEnvelopeResponse(SiteReportDto, {
    description:
      'รายงานเว็บเต็ม (DB-read): metrics (DR/UR/BL/LW/SS/AI) + organic + keyword + analysis ล่าสุด',
  })
  get(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.report.getReport(projectId);
  }

  @Get('report-status/:jobId')
  @ApiEnvelopeResponse(ReportStatusDto, {
    description: 'สถานะ job รายงาน + สรุปผลเมื่อ state=completed',
  })
  status(@Param('jobId') jobId: string) {
    return this.report.status(jobId);
  }
}
