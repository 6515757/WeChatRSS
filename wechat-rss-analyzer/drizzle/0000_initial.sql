CREATE TABLE IF NOT EXISTS `feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`source_type` text DEFAULT 'generic' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` text,
	`title_filter` text,
	`created_at` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`content` text,
	`author` text,
	`published_at` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `articles_url_unique` ON `articles` (`url`);

CREATE TABLE IF NOT EXISTS `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`summary` text,
	`topics` text,
	`key_points` text,
	`key_data` text,
	`importance_score` real,
	`raw_response` text,
	`analyzed_at` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `analyses_article_id_unique` ON `analyses` (`article_id`);

CREATE TABLE IF NOT EXISTS `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`created_at` text NOT NULL
);
