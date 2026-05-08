CREATE TABLE IF NOT EXISTS `email_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`recipient` text NOT NULL,
	`article_count` integer DEFAULT 0 NOT NULL,
	`feed_count` integer DEFAULT 0 NOT NULL,
	`article_ids` text DEFAULT '[]' NOT NULL,
	`sent_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `email_digests_sent_at_idx` ON `email_digests` (`sent_at`);
