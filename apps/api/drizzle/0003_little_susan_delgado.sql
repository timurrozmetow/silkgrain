ALTER TABLE `audit_log` ADD `actor_role` varchar(20) NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `entity_label` varchar(200);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`,`created_at`);