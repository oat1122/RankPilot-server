CREATE TABLE `site_reports` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`registrar` varchar(255),
	`domain_created_at` timestamp,
	`meta_description` varchar(1024),
	`refdomains_new` int,
	`refdomains_lost` int,
	`spam_score` smallint,
	`ai_mentions` int,
	`analysis` json,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_site_reports_project` UNIQUE(`project_id`)
);
--> statement-breakpoint
ALTER TABLE `backlink_snapshots` ADD `backlinks` int;