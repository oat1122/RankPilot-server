import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectDto, ProjectListDto } from './dto/project-response.dto';
import { ProjectsService } from './projects.service';

/**
 * /projects — โปรเจคของ user (เอกสาร 01 §2). controller บาง: scope ด้วย @CurrentUser แล้ว
 * delegate service. detail ใช้ service.getOwned (เช็คเจ้าของในตัว = ไม่ต้องใส่ ProjectAccessGuard
 * ซ้ำ); domain อื่นที่ไม่มี ownership check เอง ค่อยใช้ guard นั้น.
 */
@ApiTags('projects')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiEnvelopeResponse(ProjectListDto, {
    description: 'โปรเจคทั้งหมดของ user ปัจจุบัน (project switcher)',
  })
  list(@CurrentUser() user: AuthUser) {
    return this.projects.listForUser(user.id);
  }

  @Post()
  @ApiEnvelopeResponse(ProjectDto, {
    status: 201,
    description: 'สร้างโปรเจคใหม่ (เป็นของ user ปัจจุบัน)',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.id, dto);
  }

  @Get(':projectId')
  @ApiEnvelopeResponse(ProjectDto, { description: 'รายละเอียดโปรเจค' })
  detail(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.getOwned(projectId, user.id);
  }
}
