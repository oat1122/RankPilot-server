/**
 * RankPilot DB schema — Drizzle (dialect mysql / driver mysql2) บน MariaDB 11.8.
 * Source of truth: เอกสาร 01 §2 (ตาราง core). ชื่อ table/column/index ตรง snake_case
 * + uq_/ix_ ตามเอกสารเป๊ะ ๆ.
 *
 * หมายเหตุ FK (เอกสาร 01 §2 ท้ายตาราง): ใช้ index ธรรมดา + บังคับ integrity ในชั้น service
 * (ไม่ใช้ hard FK) ∵ งาน high-write/crawl ปิด FK เพื่อความเร็ว แล้ว cascade เองตอนลบ project.
 */
import {
  mysqlTable,
  bigint,
  varchar,
  text,
  int,
  smallint,
  boolean,
  timestamp,
  json,
  mysqlEnum,
  char,
  index,
  uniqueIndex,
  decimal,
  customType,
  primaryKey,
} from 'drizzle-orm/mysql-core';
import { vector, EMBEDDING_DIM } from './types/vector';

/**
 * LONGBLOB — Drizzle ไม่มี blob type สำหรับ mysql core → custom type. mysql2 คืนค่าเป็น Buffer
 * (เป็น Uint8Array subclass). ใช้เก็บ checkpoint/serialized writes ของ LangGraph (เอกสาร 02 Phase 4).
 */
const longblob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'longblob';
  },
});

const pk = () =>
  bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();
const fk = (n: string) => bigint(n, { mode: 'number', unsigned: true });

/* ---------- users / projects ---------- */
export const users = mysqlTable(
  'users',
  {
    id: pk(),
    clerkUserId: varchar('clerk_user_id', { length: 64 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ byClerk: uniqueIndex('uq_users_clerk').on(t.clerkUserId) }),
);

export const projects = mysqlTable(
  'projects',
  {
    id: pk(),
    ownerId: fk('owner_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    domain: varchar('domain', { length: 255 }).notNull(), // target ของ Ahrefs
    country: char('country', { length: 2 }).notNull().default('th'),
    // เพดาน units/เดือน ระดับโปรเจค (sub-allocation จาก workspace) — default = โควต้า Lite จริง
    // ที่ยืนยันผ่าน limits-and-usage (workspace=100000, 2026-06-07; เอกสาร 03/03a §10).
    monthlyUnitBudget: int('monthly_unit_budget').notNull().default(100000),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ byOwner: index('ix_projects_owner').on(t.ownerId) }),
);

/* ---------- crawls (1 รอบ = 1 snapshot batch) ---------- */
export const crawls = mysqlTable(
  'crawls',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    status: mysqlEnum('status', [
      'queued',
      'running',
      'done',
      'failed',
      'partial',
    ])
      .notNull()
      .default('queued'),
    trigger: mysqlEnum('trigger', ['manual', 'scheduled', 'api'])
      .notNull()
      .default('manual'),
    pagesDiscovered: int('pages_discovered').notNull().default(0),
    pagesCrawled: int('pages_crawled').notNull().default(0),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byProject: index('ix_crawls_project').on(t.projectId, t.createdAt),
  }),
);

/* ---------- pages (entity ถาวรของ URL) ---------- */
export const pages = mysqlTable(
  'pages',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    urlHash: char('url_hash', { length: 40 }).notNull(), // sha1(url) → unique/index
    isIndexable: boolean('is_indexable').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => ({
    uqUrl: uniqueIndex('uq_pages_proj_urlhash').on(t.projectId, t.urlHash),
  }),
);

/* ---------- page_snapshots (on-page ต่อรอบ) ---------- */
export const pageSnapshots = mysqlTable(
  'page_snapshots',
  {
    id: pk(),
    crawlId: fk('crawl_id').notNull(),
    pageId: fk('page_id').notNull(),
    httpStatus: smallint('http_status').notNull(),
    redirectTo: varchar('redirect_to', { length: 2048 }),
    title: varchar('title', { length: 1024 }),
    metaDescription: varchar('meta_description', { length: 1024 }),
    h1: varchar('h1', { length: 1024 }),
    headings: json('headings'), // {h1:[],h2:[],h3:[]}
    paragraphs: json('paragraphs'), // ['ย่อหน้า 1', ...] จาก <p> — โครงสร้าง/intro สำหรับ keyword coverage (para1) + วิเคราะห์เนื้อหา (เอกสาร 01 §2)
    wordCount: int('word_count').notNull().default(0),
    canonical: varchar('canonical', { length: 2048 }),
    robotsMeta: varchar('robots_meta', { length: 255 }),
    schemaTypes: json('schema_types'), // ['FAQPage','Article'] จาก JSON-LD
    internalLinks: int('internal_links').notNull().default(0),
    externalLinks: int('external_links').notNull().default(0),
    imagesTotal: int('images_total').notNull().default(0),
    imagesMissingAlt: int('images_missing_alt').notNull().default(0),
    lcpMs: int('lcp_ms'),
    clsX1000: int('cls_x1000'),
    inpMs: int('inp_ms'), // CWV จาก PSI API
    contentHash: char('content_hash', { length: 40 }), // เทียบว่าหน้าเปลี่ยนไหม
    htmlStorageKey: varchar('html_storage_key', { length: 512 }), // R2 key
    bodyText: text('body_text'), // เก็บไว้ทำ embedding/AI (หรือไปอยู่ R2)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byPage: index('ix_snap_page').on(t.pageId, t.createdAt),
    byCrawl: index('ix_snap_crawl').on(t.crawlId),
  }),
);

/* ---------- internal link graph (orphan + link opportunity) ---------- */
export const pageLinks = mysqlTable(
  'page_links',
  {
    id: pk(),
    crawlId: fk('crawl_id').notNull(),
    fromPageId: fk('from_page_id').notNull(),
    toPageId: fk('to_page_id'), // null = external
    toUrl: varchar('to_url', { length: 2048 }).notNull(),
    anchorText: varchar('anchor_text', { length: 512 }),
    rel: varchar('rel', { length: 64 }),
    isInternal: boolean('is_internal').notNull(),
  },
  (t) => ({
    byFrom: index('ix_links_from').on(t.fromPageId),
    byTo: index('ix_links_to').on(t.toPageId),
  }),
);

/* ---------- page_images (image auditor) ---------- */
export const pageImages = mysqlTable(
  'page_images',
  {
    id: pk(),
    snapshotId: fk('snapshot_id').notNull(),
    src: varchar('src', { length: 2048 }).notNull(),
    alt: varchar('alt', { length: 1024 }),
    hasAlt: boolean('has_alt').notNull().default(false),
    bytes: int('bytes'),
  },
  (t) => ({ bySnap: index('ix_img_snap').on(t.snapshotId) }),
);

/* ---------- embeddings (VECTOR) ---------- */
export const pageEmbeddings = mysqlTable(
  'page_embeddings',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    pageId: fk('page_id').notNull(),
    crawlId: fk('crawl_id').notNull(),
    model: varchar('model', { length: 64 }).notNull(), // 'voyage-3.5'
    contentHash: char('content_hash', { length: 40 }).notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byPage: index('ix_emb_page').on(t.pageId),
    // VECTOR INDEX เพิ่มผ่าน raw migration (เอกสาร 01 §3 → migrations/9999_vector_index.sql)
  }),
);

/* ---------- keywords (Keywords Explorer) ---------- */
export const keywords = mysqlTable(
  'keywords',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    keyword: varchar('keyword', { length: 512 }).notNull(),
    country: char('country', { length: 2 }).notNull(),
    searchVolume: int('search_volume'),
    difficulty: smallint('difficulty'), // KD 0-100
    cpc: decimal('cpc', { precision: 10, scale: 2 }),
    trafficPotential: int('traffic_potential'),
    parentTopic: varchar('parent_topic', { length: 512 }),
    intent: mysqlEnum('intent', [
      'informational',
      'navigational',
      'commercial',
      'transactional',
      'unknown',
    ]).default('unknown'),
    lastEnrichedAt: timestamp('last_enriched_at'),
  },
  (t) => ({
    uq: uniqueIndex('uq_kw').on(t.projectId, t.keyword, t.country),
  }),
);

/* ---------- page_keywords (organic ranking ต่อรอบ) ---------- */
export const pageKeywords = mysqlTable(
  'page_keywords',
  {
    id: pk(),
    pageId: fk('page_id').notNull(),
    keywordId: fk('keyword_id').notNull(),
    crawlId: fk('crawl_id'),
    position: smallint('position'),
    previousPosition: smallint('previous_position'),
    traffic: int('traffic'),
    trafficValue: decimal('traffic_value', { precision: 12, scale: 2 }),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
  },
  (t) => ({
    byPage: index('ix_pk_page').on(t.pageId),
    byKw: index('ix_pk_kw').on(t.keywordId, t.capturedAt),
  }),
);

/* ---------- keyword_rank_daily (Rank Tracker time-series) ---------- */
export const keywordRankDaily = mysqlTable(
  'keyword_rank_daily',
  {
    id: pk(),
    keywordId: fk('keyword_id').notNull(),
    pageId: fk('page_id'),
    position: smallint('position'),
    day: char('day', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  },
  (t) => ({ uq: uniqueIndex('uq_rank_day').on(t.keywordId, t.day) }),
);

/* ---------- backlink_snapshots (Site Explorer backlinks) ---------- */
export const backlinkSnapshots = mysqlTable(
  'backlink_snapshots',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    pageId: fk('page_id'), // null = ระดับ domain
    referringDomains: int('referring_domains'),
    urlRating: smallint('url_rating'),
    domainRating: smallint('domain_rating'),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
  },
  (t) => ({ byPage: index('ix_bl_page').on(t.pageId, t.capturedAt) }),
);

/* ---------- serp_results (SERP overview top 100) + competitors ---------- */
export const serpResults = mysqlTable(
  'serp_results',
  {
    id: pk(),
    keywordId: fk('keyword_id').notNull(),
    position: smallint('position').notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    domain: varchar('domain', { length: 255 }).notNull(),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
  },
  (t) => ({ byKw: index('ix_serp_kw').on(t.keywordId, t.capturedAt) }),
);

export const competitors = mysqlTable(
  'competitors',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    domain: varchar('domain', { length: 255 }).notNull(),
  },
  (t) => ({ uq: uniqueIndex('uq_comp').on(t.projectId, t.domain) }),
);

/* ---------- analysis outputs ---------- */
export const seoScores = mysqlTable(
  'seo_scores',
  {
    id: pk(),
    snapshotId: fk('snapshot_id').notNull(),
    keywordCoverage: smallint('keyword_coverage'), // 0-100: title/url/h1/h2/para1
    healthScore: smallint('health_score'), // 0-100
    breakdown: json('breakdown'),
  },
  (t) => ({ bySnap: uniqueIndex('uq_score_snap').on(t.snapshotId) }),
);

export const auditFindings = mysqlTable(
  'audit_findings',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    pageId: fk('page_id'),
    crawlId: fk('crawl_id'),
    type: varchar('type', { length: 64 }).notNull(), // missing_alt | no_h1 | title_len | orphan | cannibalization | content_gap | slow_lcp ...
    severity: mysqlEnum('severity', [
      'low',
      'medium',
      'high',
      'critical',
    ]).notNull(),
    impactScore: int('impact_score').notNull().default(0), // priority = business × traffic
    status: mysqlEnum('status', ['open', 'in_progress', 'fixed', 'ignored'])
      .notNull()
      .default('open'),
    details: json('details'),
    detectedAt: timestamp('detected_at').notNull().defaultNow(),
    fixedAt: timestamp('fixed_at'),
  },
  (t) => ({
    byProject: index('ix_find_project').on(
      t.projectId,
      t.status,
      t.impactScore,
    ),
  }),
);

export const cannibalizationGroups = mysqlTable('cannibalization_groups', {
  id: pk(),
  projectId: fk('project_id').notNull(),
  keywordId: fk('keyword_id').notNull(),
  verdict: mysqlEnum('verdict', ['real_issue', 'benign', 'needs_review'])
    .notNull()
    .default('needs_review'),
  intentNote: text('intent_note'), // LLM อธิบายว่า intent ต่าง/เหมือน
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const cannibalizationMembers = mysqlTable(
  'cannibalization_members',
  {
    id: pk(),
    groupId: fk('group_id').notNull(),
    pageId: fk('page_id').notNull(),
    position: smallint('position'),
    similarity: decimal('similarity', { precision: 5, scale: 4 }), // cosine จาก VECTOR
  },
  (t) => ({ byGroup: index('ix_cm_group').on(t.groupId) }),
);

export const contentGaps = mysqlTable('content_gaps', {
  id: pk(),
  projectId: fk('project_id').notNull(),
  pageId: fk('page_id'),
  keywordId: fk('keyword_id'),
  missingSubtopic: varchar('missing_subtopic', { length: 512 }),
  competitorDomains: json('competitor_domains'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const internalLinkOpportunities = mysqlTable(
  'internal_link_opportunities',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    fromPageId: fk('from_page_id').notNull(),
    toPageId: fk('to_page_id').notNull(),
    targetKeywordId: fk('target_keyword_id'),
    score: int('score').notNull().default(0),
    status: mysqlEnum('status', ['open', 'done', 'ignored'])
      .notNull()
      .default('open'),
  },
);

/* ---------- AI (เอกสาร 02) ---------- */
export const aiRuns = mysqlTable('ai_runs', {
  id: pk(),
  projectId: fk('project_id').notNull(),
  pageId: fk('page_id'),
  graph: varchar('graph', { length: 64 }).notNull(), // 'page_audit'
  // snapshot role→modelId ที่ใช้รอบนั้น (เอกสาร 01 / 02 §6) → audit ต้นทุน/คุณภาพย้อนหลัง
  models: json('models'), // { reasoner, worker, cheap }
  langsmithRunId: varchar('langsmith_run_id', { length: 64 }),
  status: mysqlEnum('status', ['running', 'done', 'failed', 'awaiting_review'])
    .notNull()
    .default('running'),
  // Phase 4 (HITL): proposal ที่ค้างรอ user อนุมัติ (= toRecommendationRows ตอน interrupt) →
  // dashboard อ่านโชว์ก่อน approve/reject; เคลียร์เป็น null เมื่อ persist/reject เสร็จ (เอกสาร 02 §8).
  reviewPayload: json('review_payload'),
  inputTokens: int('input_tokens'),
  outputTokens: int('output_tokens'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
});

/* ---------- AI config: model selection ต่อโปรเจค (เอกสาร 02 §3 / Phase 5) ---------- */
// projectId null = global default (ใช้ทุกโปรเจคที่ไม่ตั้งเอง). models = { reasoner:{modelId,
// temperature,maxTokens}, worker, cheap } (role→cfg). provider = openrouter routing prefs.
export const aiSettings = mysqlTable(
  'ai_settings',
  {
    id: pk(),
    projectId: fk('project_id'), // null = global default
    models: json('models').notNull(),
    provider: json('provider'), // { require_parameters, sort }
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    uqProject: uniqueIndex('uq_ai_settings_project').on(t.projectId),
  }),
);

/* ---------- AI skills: ฉีดความรู้รายโหนด เปิด/ปิดได้ (เอกสาร 02 §4 / Phase 5) ---------- */
// projectId null = global library. body = markdown ที่ AI อ่านก่อนตอบ. appliesTo = ['diagnose',
// 'draft'] หรือ ['*'] (ทุกโหนด). resolve: enabled + (project นี้/global) + node ∈ appliesTo, เรียง priority desc.
export const aiSkills = mysqlTable(
  'ai_skills',
  {
    id: pk(),
    projectId: fk('project_id'), // null = global library
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 512 }).notNull(),
    body: text('body').notNull(),
    appliesTo: json('applies_to').notNull(), // string[] (node names หรือ ['*'])
    enabled: boolean('enabled').notNull().default(true),
    priority: smallint('priority').notNull().default(0), // มากก่อน (บนสุดของ prefix)
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    uqSlug: uniqueIndex('uq_ai_skill_slug').on(t.projectId, t.slug),
    byEnabled: index('ix_ai_skill_enabled').on(t.projectId, t.enabled),
  }),
);

export const aiRecommendations = mysqlTable(
  'ai_recommendations',
  {
    id: pk(),
    runId: fk('run_id').notNull(),
    pageId: fk('page_id').notNull(),
    findingId: fk('finding_id'),
    type: mysqlEnum('type', [
      'diagnosis',
      'title_draft',
      'meta_draft',
      'intent',
      'content_gap',
      'query_fanout',
      'priority',
    ]).notNull(),
    output: json('output').notNull(), // {title, metaDescription, reasoning, ...}
    status: mysqlEnum('status', ['suggested', 'applied', 'rejected'])
      .notNull()
      .default('suggested'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ byPage: index('ix_rec_page').on(t.pageId, t.status) }),
);

/* ---------- AI checkpointer (LangGraph HITL — เอกสาร 02 Phase 4) ---------- */
// persistent checkpointer แทน MemorySaver → resume graph ข้าม process/หลัง restart ได้
// (จำเป็นต่อ awaitReview interrupt: รัน job เก็บ checkpoint, resume job คนละ process อ่านต่อ).
// schema มิเรอร์ official saver (checkpoints + checkpoint_writes); blob = serde ของ LangGraph.
export const aiCheckpoints = mysqlTable(
  'ai_checkpoints',
  {
    threadId: varchar('thread_id', { length: 255 }).notNull(), // = page:<id>:run:<runId>
    checkpointNs: varchar('checkpoint_ns', { length: 255 })
      .notNull()
      .default(''),
    checkpointId: varchar('checkpoint_id', { length: 64 }).notNull(), // uuid6 (time-ordered)
    parentCheckpointId: varchar('parent_checkpoint_id', { length: 64 }),
    checkpoint: longblob('checkpoint').notNull(), // serde.dumpsTyped(checkpoint)
    metadata: longblob('metadata').notNull(), // serde.dumpsTyped(metadata)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // ตั้งชื่อ PK เอง — auto-name ของ Drizzle ยาวเกิน 64 ตัว (ER_TOO_LONG_IDENT ของ MariaDB)
    pk: primaryKey({
      name: 'pk_ai_checkpoints',
      columns: [t.threadId, t.checkpointNs, t.checkpointId],
    }),
  }),
);

export const aiCheckpointWrites = mysqlTable(
  'ai_checkpoint_writes',
  {
    threadId: varchar('thread_id', { length: 255 }).notNull(),
    checkpointNs: varchar('checkpoint_ns', { length: 255 })
      .notNull()
      .default(''),
    checkpointId: varchar('checkpoint_id', { length: 64 }).notNull(),
    taskId: varchar('task_id', { length: 64 }).notNull(),
    idx: int('idx').notNull(), // WRITES_IDX_MAP[channel] ?? ลำดับใน writes
    channel: varchar('channel', { length: 255 }).notNull(),
    blob: longblob('blob').notNull(), // serde.dumpsTyped(value)
  },
  (t) => ({
    // ตั้งชื่อ PK เอง — auto-name (table+5 cols) ยาว 71 ตัว > 64 (ER_TOO_LONG_IDENT ของ MariaDB)
    pk: primaryKey({
      name: 'pk_ai_ckpt_writes',
      columns: [t.threadId, t.checkpointNs, t.checkpointId, t.taskId, t.idx],
    }),
  }),
);

/* ---------- alerts ---------- */
export const alerts = mysqlTable('alerts', {
  id: pk(),
  projectId: fk('project_id').notNull(),
  type: varchar('type', { length: 64 }).notNull(), // rank_drop | crawl_error | budget_low
  channel: mysqlEnum('channel', ['slack', 'email']).notNull(),
  payload: json('payload'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/* ---------- ahrefs_cache (durable cache ต่อ request — เอกสาร 03 §2) ---------- */
// เก็บ response ดิบของแต่ละ Ahrefs request (key = endpoint+paramsHash) + units จริงที่ใช้
// → ชั้น CacheLayer อ่านก่อนยิงซ้ำ (กัน units บาน) และเป็น archive ให้ตรวจย้อนหลัง.
export const ahrefsCache = mysqlTable(
  'ahrefs_cache',
  {
    id: pk(),
    endpoint: varchar('endpoint', { length: 128 }).notNull(),
    paramsHash: char('params_hash', { length: 40 }).notNull(), // sha1(endpoint+params)
    response: json('response').notNull(),
    unitsSpent: int('units_spent').notNull(),
    rows: int('rows').notNull().default(0),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => ({ uq: uniqueIndex('uq_cache').on(t.endpoint, t.paramsHash) }),
);

/* ---------- ahrefs_usage (งบ units ต่อโปรเจคต่อเดือน — เอกสาร 03 §2/§5) ---------- */
// ground truth แบบ durable ของยอดใช้จริง (Redis เป็น hot counter สำหรับ reserve/settle)
// — bump ทุกครั้งหลังยิงจริง, ใช้ reconcile กับ limits-and-usage ภายหลัง.
export const ahrefsUsage = mysqlTable(
  'ahrefs_usage',
  {
    id: pk(),
    projectId: fk('project_id').notNull(),
    period: char('period', { length: 7 }).notNull(), // 'YYYY-MM'
    unitsSpent: int('units_spent').notNull().default(0),
    requests: int('requests').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({ uq: uniqueIndex('uq_usage').on(t.projectId, t.period) }),
);
