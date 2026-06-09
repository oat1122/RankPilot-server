import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AiModelsDto,
  AiSettingsViewDto,
  AiUsageDto,
  AiUsageQueryDto,
  CreateSkillDto,
  PutAiSettingsDto,
  SkillCreatedDto,
  SkillsListDto,
  ToggleSkillDto,
  UpdateSkillDto,
} from './dto/ai-config.dto';
import { AiConfigService } from './ai-config.service';

/**
 * /ai/* — AI config ที่ไม่ผูก project (Phase 5/6, เอกสาร 02 §3/§4): proxy รายการ model + global
 * default settings + global skill library + usage analytics. ส่วนที่ผูก project (settings + list/
 * create skills รายโปรเจค) อยู่ใน AiController (/projects/:id/ai/*). controller บาง ๆ → ตอบผ่าน envelope.
 *
 * RBAC: @UseGuards(RolesGuard) ระดับ class → route ที่มี @Roles('admin') = admin เท่านั้น (แก้ config/
 * ดู usage), route ที่ไม่มี @Roles = ทุก authenticated user (ดู models/settings/skills). RolesGuard
 * วางหลัง global ClerkAuthGuard (req.user พร้อม) — แพทเทิร์นเดียวกับ UsersController.
 */
@ApiTags('ai-config')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@UseGuards(RolesGuard)
@Controller('ai')
export class AiConfigController {
  constructor(private readonly config: AiConfigService) {}

  @Get('models')
  @ApiEnvelopeResponse(AiModelsDto, {
    description:
      'รายการ model ของ OpenRouter (cache 1h) — FE filter supported_parameters ∋ structured_outputs เอง (เอกสาร 02 §3)',
  })
  models() {
    return this.config.models();
  }

  // ---------- global default settings (Phase 6) ----------

  @Get('settings')
  @ApiEnvelopeResponse(AiSettingsViewDto, {
    description:
      'global default ai_settings (projectId null) + map role→modelId ที่ใช้จริง (merge DEFAULTS)',
  })
  globalSettings() {
    return this.config.getGlobalSettings();
  }

  @Put('settings')
  @Roles('admin')
  @ApiEnvelopeResponse(AiSettingsViewDto, {
    description:
      'ตั้ง model global default ต่อ role (admin) — upsert row projectId null',
  })
  putGlobalSettings(@Body() dto: PutAiSettingsDto) {
    return this.config.putGlobalSettings(dto);
  }

  // ---------- global skill library (Phase 6) ----------

  @Get('skills')
  @ApiEnvelopeResponse(SkillsListDto, {
    description:
      'global skill library (projectId null) รวมที่ปิดอยู่ — view ได้ทุก user',
  })
  listGlobalSkills() {
    return this.config.listGlobalSkills();
  }

  @Post('skills')
  @Roles('admin')
  @ApiEnvelopeResponse(SkillCreatedDto, {
    status: 201,
    description: 'สร้าง global skill (admin) — markdown body + appliesTo',
  })
  createGlobalSkill(@Body() dto: CreateSkillDto) {
    return this.config.createGlobalSkill(dto);
  }

  @Patch('skills/:skillId')
  @Roles('admin')
  @ApiEnvelopeResponse(SkillCreatedDto, {
    description:
      'แก้ skill (body/appliesTo/priority/ชื่อ) — admin (เอกสาร 02 §4)',
  })
  updateSkill(
    @Param('skillId', ParseIntPipe) skillId: number,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.config.updateSkill(skillId, dto);
  }

  @Patch('skills/:skillId/toggle')
  @Roles('admin')
  @ApiEnvelopeResponse(SkillCreatedDto, {
    description: 'เปิด/ปิด skill (enabled) — admin (เอกสาร 02 §4)',
  })
  toggleSkill(
    @Param('skillId', ParseIntPipe) skillId: number,
    @Body() dto: ToggleSkillDto,
  ) {
    return this.config.toggleSkill(skillId, dto.enabled);
  }

  // ---------- usage analytics (Phase 6 — admin only) ----------

  @Get('usage')
  @Roles('admin')
  @ApiEnvelopeResponse(AiUsageDto, {
    description:
      'สรุป token usage ต่อ user × model(หลัก=reasoner) × เดือน + ยอดรวม (admin) — ใครใช้ AI ตัวไหน ใช้ไปเท่าไหร่',
  })
  usage(@Query() query: AiUsageQueryDto) {
    return this.config.aiUsage(query);
  }
}
