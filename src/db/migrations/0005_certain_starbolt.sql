CREATE TABLE `ai_checkpoint_writes` (
	`thread_id` varchar(255) NOT NULL,
	`checkpoint_ns` varchar(255) NOT NULL DEFAULT '',
	`checkpoint_id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`idx` int NOT NULL,
	`channel` varchar(255) NOT NULL,
	`blob` longblob NOT NULL,
	CONSTRAINT `pk_ai_ckpt_writes` PRIMARY KEY(`thread_id`,`checkpoint_ns`,`checkpoint_id`,`task_id`,`idx`)
);
--> statement-breakpoint
CREATE TABLE `ai_checkpoints` (
	`thread_id` varchar(255) NOT NULL,
	`checkpoint_ns` varchar(255) NOT NULL DEFAULT '',
	`checkpoint_id` varchar(64) NOT NULL,
	`parent_checkpoint_id` varchar(64),
	`checkpoint` longblob NOT NULL,
	`metadata` longblob NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pk_ai_checkpoints` PRIMARY KEY(`thread_id`,`checkpoint_ns`,`checkpoint_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned,
	`models` json NOT NULL,
	`provider` json,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ai_settings_project` UNIQUE(`project_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_skills` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned,
	`slug` varchar(96) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(512) NOT NULL,
	`body` text NOT NULL,
	`applies_to` json NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`priority` smallint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ai_skill_slug` UNIQUE(`project_id`,`slug`)
);
--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `review_payload` json;--> statement-breakpoint
CREATE INDEX `ix_ai_skill_enabled` ON `ai_skills` (`project_id`,`enabled`);