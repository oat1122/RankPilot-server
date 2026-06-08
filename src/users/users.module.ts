import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepo } from './users.repo';

/**
 * UsersModule — UserManager (เอกสาร 05 §4). controller บาง + service/repo. RolesGuard มาจาก
 * AuthModule (@Global) ไม่ต้อง provide ที่นี่. DB token มาจาก DbModule (@Global).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepo],
})
export class UsersModule {}
