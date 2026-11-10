CREATE TABLE `backtests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`symbol` text NOT NULL,
	`source` text NOT NULL,
	`config` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
