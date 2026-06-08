import { createZodDto } from 'nestjs-zod';
import { createProjectSchema } from './create-project.dto';

/**
 * body ของ PATCH /projects/:id — partial ของ create (แก้ทีละ field ได้). reuse refine domain
 * (hostname เปล่า ไม่มี scheme/path) จาก createProjectSchema ผ่าน `.partial()` → ไม่ซ้ำกติกา.
 * บังคับให้มีอย่างน้อย 1 field (กัน PATCH เปล่าที่ไม่ทำอะไร → ตอบ VALIDATION_FAILED).
 */
export const updateProjectSchema = createProjectSchema
  .partial()
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'ต้องมีอย่างน้อย 1 field ที่จะแก้ไข (name/domain/country)',
  });

export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
