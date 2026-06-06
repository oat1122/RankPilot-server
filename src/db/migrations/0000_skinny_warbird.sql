CREATE TABLE `ai_recommendations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`run_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned NOT NULL,
	`finding_id` bigint unsigned,
	`type` enum('diagnosis','title_draft','meta_draft','intent','content_gap','query_fanout','priority') NOT NULL,
	`output` json NOT NULL,
	`status` enum('suggested','applied','rejected') NOT NULL DEFAULT 'suggested',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_recommendations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned,
	`graph` varchar(64) NOT NULL,
	`langsmith_run_id` varchar(64),
	`status` enum('running','done','failed','awaiting_review') NOT NULL DEFAULT 'running',
	`input_tokens` int,
	`output_tokens` int,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	CONSTRAINT `ai_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`type` varchar(64) NOT NULL,
	`channel` enum('slack','email') NOT NULL,
	`payload` json,
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_findings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned,
	`crawl_id` bigint unsigned,
	`type` varchar(64) NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL,
	`impact_score` int NOT NULL DEFAULT 0,
	`status` enum('open','in_progress','fixed','ignored') NOT NULL DEFAULT 'open',
	`details` json,
	`detected_at` timestamp NOT NULL DEFAULT (now()),
	`fixed_at` timestamp,
	CONSTRAINT `audit_findings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backlink_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned,
	`referring_domains` int,
	`url_rating` smallint,
	`domain_rating` smallint,
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backlink_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cannibalization_groups` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`keyword_id` bigint unsigned NOT NULL,
	`verdict` enum('real_issue','benign','needs_review') NOT NULL DEFAULT 'needs_review',
	`intent_note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cannibalization_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cannibalization_members` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`group_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned NOT NULL,
	`position` smallint,
	`similarity` decimal(5,4),
	CONSTRAINT `cannibalization_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`domain` varchar(255) NOT NULL,
	CONSTRAINT `competitors_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comp` UNIQUE(`project_id`,`domain`)
);
--> statement-breakpoint
CREATE TABLE `content_gaps` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned,
	`keyword_id` bigint unsigned,
	`missing_subtopic` varchar(512),
	`competitor_domains` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_gaps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crawls` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`status` enum('queued','running','done','failed','partial') NOT NULL DEFAULT 'queued',
	`trigger` enum('manual','scheduled','api') NOT NULL DEFAULT 'manual',
	`pages_discovered` int NOT NULL DEFAULT 0,
	`pages_crawled` int NOT NULL DEFAULT 0,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crawls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `internal_link_opportunities` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`from_page_id` bigint unsigned NOT NULL,
	`to_page_id` bigint unsigned NOT NULL,
	`target_keyword_id` bigint unsigned,
	`score` int NOT NULL DEFAULT 0,
	`status` enum('open','done','ignored') NOT NULL DEFAULT 'open',
	CONSTRAINT `internal_link_opportunities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_rank_daily` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`keyword_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned,
	`position` smallint,
	`day` char(10) NOT NULL,
	CONSTRAINT `keyword_rank_daily_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_rank_day` UNIQUE(`keyword_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`keyword` varchar(512) NOT NULL,
	`country` char(2) NOT NULL,
	`search_volume` int,
	`difficulty` smallint,
	`cpc` decimal(10,2),
	`traffic_potential` int,
	`parent_topic` varchar(512),
	`intent` enum('informational','navigational','commercial','transactional','unknown') DEFAULT 'unknown',
	`last_enriched_at` timestamp,
	CONSTRAINT `keywords_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_kw` UNIQUE(`project_id`,`keyword`,`country`)
);
--> statement-breakpoint
CREATE TABLE `page_embeddings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned NOT NULL,
	`crawl_id` bigint unsigned NOT NULL,
	`model` varchar(64) NOT NULL,
	`content_hash` char(40) NOT NULL,
	`embedding` vector(1024) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `page_embeddings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `page_images` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`snapshot_id` bigint unsigned NOT NULL,
	`src` varchar(2048) NOT NULL,
	`alt` varchar(1024),
	`has_alt` boolean NOT NULL DEFAULT false,
	`bytes` int,
	CONSTRAINT `page_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `page_keywords` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`page_id` bigint unsigned NOT NULL,
	`keyword_id` bigint unsigned NOT NULL,
	`crawl_id` bigint unsigned,
	`position` smallint,
	`previous_position` smallint,
	`traffic` int,
	`traffic_value` decimal(12,2),
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `page_keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `page_links` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`crawl_id` bigint unsigned NOT NULL,
	`from_page_id` bigint unsigned NOT NULL,
	`to_page_id` bigint unsigned,
	`to_url` varchar(2048) NOT NULL,
	`anchor_text` varchar(512),
	`rel` varchar(64),
	`is_internal` boolean NOT NULL,
	CONSTRAINT `page_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `page_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`crawl_id` bigint unsigned NOT NULL,
	`page_id` bigint unsigned NOT NULL,
	`http_status` smallint NOT NULL,
	`redirect_to` varchar(2048),
	`title` varchar(1024),
	`meta_description` varchar(1024),
	`h1` varchar(1024),
	`headings` json,
	`word_count` int NOT NULL DEFAULT 0,
	`canonical` varchar(2048),
	`robots_meta` varchar(255),
	`schema_types` json,
	`internal_links` int NOT NULL DEFAULT 0,
	`external_links` int NOT NULL DEFAULT 0,
	`images_total` int NOT NULL DEFAULT 0,
	`images_missing_alt` int NOT NULL DEFAULT 0,
	`lcp_ms` int,
	`cls_x1000` int,
	`inp_ms` int,
	`content_hash` char(40),
	`html_storage_key` varchar(512),
	`body_text` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `page_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(40) NOT NULL,
	`is_indexable` boolean NOT NULL DEFAULT true,
	`first_seen_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pages_proj_urlhash` UNIQUE(`project_id`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`owner_id` bigint unsigned NOT NULL,
	`name` varchar(200) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`country` char(2) NOT NULL DEFAULT 'th',
	`monthly_unit_budget` int NOT NULL DEFAULT 25000,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seo_scores` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`snapshot_id` bigint unsigned NOT NULL,
	`keyword_coverage` smallint,
	`health_score` smallint,
	`breakdown` json,
	CONSTRAINT `seo_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_score_snap` UNIQUE(`snapshot_id`)
);
--> statement-breakpoint
CREATE TABLE `serp_results` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`keyword_id` bigint unsigned NOT NULL,
	`position` smallint NOT NULL,
	`url` varchar(2048) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serp_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`clerk_user_id` varchar(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_clerk` UNIQUE(`clerk_user_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_rec_page` ON `ai_recommendations` (`page_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_find_project` ON `audit_findings` (`project_id`,`status`,`impact_score`);--> statement-breakpoint
CREATE INDEX `ix_bl_page` ON `backlink_snapshots` (`page_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `ix_cm_group` ON `cannibalization_members` (`group_id`);--> statement-breakpoint
CREATE INDEX `ix_crawls_project` ON `crawls` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_emb_page` ON `page_embeddings` (`page_id`);--> statement-breakpoint
CREATE INDEX `ix_img_snap` ON `page_images` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `ix_pk_page` ON `page_keywords` (`page_id`);--> statement-breakpoint
CREATE INDEX `ix_pk_kw` ON `page_keywords` (`keyword_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `ix_links_from` ON `page_links` (`from_page_id`);--> statement-breakpoint
CREATE INDEX `ix_links_to` ON `page_links` (`to_page_id`);--> statement-breakpoint
CREATE INDEX `ix_snap_page` ON `page_snapshots` (`page_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_snap_crawl` ON `page_snapshots` (`crawl_id`);--> statement-breakpoint
CREATE INDEX `ix_projects_owner` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `ix_serp_kw` ON `serp_results` (`keyword_id`,`captured_at`);