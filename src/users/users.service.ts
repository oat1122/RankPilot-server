import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/http';
import type { AuthUser, UserRole } from '../auth/auth-user';
import { UsersRepo } from './users.repo';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

type UserStatus = 'active' | 'disabled';
type StatusChange = { role?: UserRole; status?: UserStatus };

/**
 * UsersService — UserManager logic (เอกสาร 05 §4). controller บาง → delegate ที่นี่. throw จาก
 * catalog กลาง. Safety กัน lockout: ห้าม demote/disable admin ที่ active คนสุดท้าย และห้าม actor
 * ถอนสิทธิ์/ระงับตัวเอง (กัน admin ตัดขาตัวเองจนไม่มีใครเข้าจัดการได้).
 */
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepo) {}

  async getById(id: number) {
    const user = await this.repo.findById(id);
    if (!user)
      throw new AppException(ErrorCode.USER_NOT_FOUND, `user ${id} not found`);
    return user;
  }

  async list() {
    const items = await this.repo.list();
    return { items };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing)
      throw new AppException(
        ErrorCode.USER_EMAIL_EXISTS,
        `email ${dto.email} already exists`,
      );
    return this.repo.create(dto.email, dto.role);
  }

  update(id: number, dto: UpdateUserDto, actor: AuthUser) {
    return this.applyChange(id, { role: dto.role, status: dto.status }, actor);
  }

  setStatus(id: number, status: UserStatus, actor: AuthUser) {
    return this.applyChange(id, { status }, actor);
  }

  /** อัปเดต role/status พร้อมเช็ค lockout ก่อน (อิงสภาพ "active admin" ก่อน/หลังเปลี่ยน). */
  private async applyChange(id: number, fields: StatusChange, actor: AuthUser) {
    const target = await this.getById(id);
    await this.assertNoAdminLockout(target, fields, actor);
    // set เฉพาะฟิลด์ที่ระบุ (กันเขียนทับด้วย undefined)
    const patch: StatusChange = {};
    if (fields.role !== undefined) patch.role = fields.role;
    if (fields.status !== undefined) patch.status = fields.status;
    return this.repo.updateFields(id, patch);
  }

  private async assertNoAdminLockout(
    target: { id: number; role: UserRole; status: UserStatus },
    fields: StatusChange,
    actor: AuthUser,
  ) {
    const resultRole = fields.role ?? target.role;
    const resultStatus = fields.status ?? target.status;
    const wasActiveAdmin =
      target.role === 'admin' && target.status === 'active';
    const willBeActiveAdmin =
      resultRole === 'admin' && resultStatus === 'active';
    if (!wasActiveAdmin || willBeActiveAdmin) return; // ไม่ได้ถอน active admin → ปลอดภัย

    if (actor.id === target.id)
      throw new AppException(
        ErrorCode.CONFLICT,
        'ห้ามถอนสิทธิ์/ระงับบัญชี admin ของตัวเอง',
      );
    const otherActiveAdmins = await this.repo.countActiveAdmins(target.id);
    if (otherActiveAdmins === 0)
      throw new AppException(
        ErrorCode.CONFLICT,
        'ต้องมี admin ที่ active อย่างน้อยหนึ่งคน — ระงับ/ลดสิทธิ์ไม่ได้',
      );
  }
}
