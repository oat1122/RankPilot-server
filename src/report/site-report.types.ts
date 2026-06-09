/**
 * payload ของ job 'site-report' (queue 'report') — รายงานเว็บเต็ม (apnth.com template).
 * producer (ReportService) resolve domain/country/cap/competitorsLimit/userId ตอน enqueue;
 * worker (SiteReportRunner) orchestrate Ahrefs + WHOIS + meta + AI แล้ว upsert site_reports.
 */
export interface SiteReportJobData {
  projectId: number;
  domain: string;
  country: string;
  cap: number; // เพดาน units/เดือน (resolve ตอน enqueue)
  competitorsLimit: number;
  userId?: number | null; // ผู้สั่ง (attribute ai_runs.userId — /ai/usage)
}

/** สรุปผล site-report (= job.returnvalue เมื่อ completed) — ให้ FE อ่านผ่าน GET report-status. */
export interface SiteReportSummary {
  projectId: number;
  domain: string;
  domainRating: number | null;
  backlinks: number | null;
  registrar: string | null;
  aiAnalyzed: boolean; // true = generate analysis สำเร็จ (false = ข้าม/ล้ม → degrade)
  unitsSpent: number;
}
