ALTER TABLE `users` ADD COLUMN `api_key` text;
--> statement-breakpoint
UPDATE `info` SET `value` = '5' WHERE `key` = 'migration_version';