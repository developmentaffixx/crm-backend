-- Migration: SMM Documents
-- Study documents that can be assigned to specific SMM pages

CREATE TABLE IF NOT EXISTS `smm_documents` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `content` longtext DEFAULT NULL,
  `page_targets` json NOT NULL COMMENT 'Array of page keys: content_writing, content_calendar, shoots, ads, daily_journal, report_centre, social_overview',
  `is_visible` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_smm_docs_visible` (`is_visible`, `is_active`),
  KEY `fk_smm_docs_created_by` (`created_by`),
  CONSTRAINT `fk_smm_docs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
