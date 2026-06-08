import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../auth/auth-user';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDto, UserListDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

/**
 * /users — UserManager (เอกสาร 05 §4). "ไม่มี self sign-up": admin คุม user ทั้งหมดที่นี่
 * (list/เชิญ/เปลี่ยน role/soft-disable). controller-level @Roles('admin') = default ทุก route
 * ต้องเป็น admin; เปิด GET /users/me ให้ทุก authenticated user (FE เช็คว่าตัวเองเป็น admin ไหม).
 * RolesGuard วางหลัง global ClerkAuthGuard (req.user + role พร้อม).
 */
@ApiTags('users')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('users')
@UseGuards(RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @Roles('admin', 'user') // override: ดูโปรไฟล์/role ของตัวเอง (ทุก authenticated user)
  @ApiEnvelopeResponse(UserDto, {
    description: 'โปรไฟล์ + role ของ user ปัจจุบัน',
  })
  me(@CurrentUser() user: AuthUser) {
    return this.users.getById(user.id);
  }

  @Get()
  @ApiEnvelopeResponse(UserListDto, {
    description: 'ผู้ใช้ทั้งหมด (admin เท่านั้น)',
  })
  list() {
    return this.users.list();
  }

  @Post()
  @ApiEnvelopeResponse(UserDto, {
    status: 201,
    description:
      'เชิญ/สร้าง user (invite by email + role) — bind clerk id ตอน login ครั้งแรก',
  })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':userId')
  @ApiEnvelopeResponse(UserDto, { description: 'เปลี่ยน role และ/หรือ status' })
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() actor: AuthUser,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(userId, dto, actor);
  }

  @Delete(':userId')
  @ApiEnvelopeResponse(UserDto, {
    description: 'ระงับ user (soft-disable, status=disabled) — record ยังอยู่',
  })
  disable(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.setStatus(userId, 'disabled', actor);
  }
}
