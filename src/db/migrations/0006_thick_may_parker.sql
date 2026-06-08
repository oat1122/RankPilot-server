ALTER TABLE `users` MODIFY COLUMN `clerk_user_id` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `role` enum('admin','user') DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('active','disabled') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `uq_users_email` UNIQUE(`email`);