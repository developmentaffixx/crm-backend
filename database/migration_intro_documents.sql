-- Migration: Introduction Documents (Sales > Introduction)
-- Section-wise documents with role/user-based access control
-- Same pattern as smm_documents but without page_targets (all shown on one page)

CREATE TABLE IF NOT EXISTS `intro_documents` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `sections` longtext DEFAULT NULL COMMENT 'JSON array of {title, description, order} objects',
  `access_type` ENUM('all', 'roles', 'users', 'roles_and_users') NOT NULL DEFAULT 'all',
  `allowed_roles` JSON DEFAULT NULL COMMENT 'JSON array of role IDs',
  `allowed_users` JSON DEFAULT NULL COMMENT 'JSON array of user IDs',
  `sort_order` int NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_intro_docs_active` (`is_active`),
  KEY `fk_intro_docs_created_by` (`created_by`),
  CONSTRAINT `fk_intro_docs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
