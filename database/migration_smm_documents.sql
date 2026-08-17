-- Migration: SMM Documents
-- Study documents with sections (like IBRS) that can be assigned to specific SMM pages
-- Each page assignment has its own visibility toggle

CREATE TABLE IF NOT EXISTS `smm_documents` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `sections` longtext DEFAULT NULL COMMENT 'JSON array of {title, description} like IBRS sections',
  `page_targets` longtext NOT NULL COMMENT 'JSON array of {page, visible} objects',
  `sort_order` int NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_smm_docs_active` (`is_active`),
  KEY `fk_smm_docs_created_by` (`created_by`),
  CONSTRAINT `fk_smm_docs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
