import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../common/http';
import { HealthStatusDto } from './dto/health-status.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  // ตอบผ่าน envelope กลาง: { success:true, data:{status:'ok'}, meta } (เอกสาร 04 §6)
  @ApiEnvelopeResponse(HealthStatusDto, { description: 'Service is up' })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
