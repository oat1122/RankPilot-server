import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JobsViewDto, ListJobsQueryDto } from './dto/jobs.dto';
import { JobsService } from './jobs.service';

/**
 * /jobs — มุมมองรวมงานเบื้องหลังของ user ปัจจุบัน ข้ามทุกโปรเจค (in-progress ที่รอด refresh + กระดิ่ง).
 * scope ด้วย @CurrentUser (เจ้าของโปรเจค) ในตัว service → ไม่มี :projectId จึงไม่ใช้ ProjectAccessGuard.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @ApiEnvelopeResponse(JobsViewDto, {
    description:
      'งานเบื้องหลัง (active/queued + ประวัติล่าสุด) ของทุกโปรเจคที่ user เป็นเจ้าของ — กรองด้วย projectId/pageId ได้',
  })
  list(@CurrentUser() user: AuthUser, @Query() query: ListJobsQueryDto) {
    return this.jobs.list(user.id, query);
  }
}
