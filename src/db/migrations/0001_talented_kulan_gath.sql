CREATE TABLE `ahrefs_cache` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`endpoint` varchar(128) NOT NULL,
	`params_hash` char(40) NOT NULL,
	`response` json NOT NULL,
	`units_spent` int NOT NULL,
	`rows` int NOT NULL DEFAULT 0,
	`fetched_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `ahrefs_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cache` UNIQUE(`endpoint`,`params_hash`)
);
--> statement-breakpoint
CREATE TABLE `ahrefs_usage` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`project_id` bigint unsigned NOT NULL,
	`period` char(7) NOT NULL,
	`units_spent` int NOT NULL DEFAULT 0,
	`requests` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ahrefs_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_usage` UNIQUE(`project_id`,`period`)
);
