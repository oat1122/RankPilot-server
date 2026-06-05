// รันก่อนโหลด AppModule (jest setupFiles) — env ถูก validate ตอน import module.
// REDIS_URL required แล้ว (BullMQ) แต่ lazyConnect ทำให้ e2e ไม่ต้องมี Redis สด.
process.env.REDIS_URL ??= 'redis://localhost:6379';
