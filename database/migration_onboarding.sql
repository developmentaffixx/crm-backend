-- Onboarding migration
-- Two tables used by the employee onboarding module:
--   1. pillars_candidate_registration — stores invite credentials
--   2. pillars_candidate_details      — stores submitted onboarding form data

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: pillars_candidate_details
-- Stores all form sections submitted by the candidate on the external
-- onboarding portal (pillaronboard.affixxmedia.com).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `pillars_candidate_details` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `afid` varchar(100) NOT NULL,
  `applicant_data` text DEFAULT NULL,
  `personal_data` text DEFAULT NULL,
  `address_data` text DEFAULT NULL,
  `education_data` text DEFAULT NULL,
  `experience_data` text DEFAULT NULL,
  `emergency_data` text DEFAULT NULL,
  `experience_type` varchar(50) DEFAULT 'fresher',
  `documents` text DEFAULT NULL,
  `onboarding_status` enum('pending','in_progress','completed','approved','rejected') DEFAULT 'pending',
  `progress_percentage` int(3) DEFAULT 0,
  `instructions_seen` tinyint(1) DEFAULT 0,
  `declaration_accepted` tinyint(1) DEFAULT 0,
  `submitted_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX idx_afid (`afid`),
  INDEX idx_status (`onboarding_status`),
  INDEX idx_deleted (`deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: pillars_candidate_registration
-- Holds the AFID, candidate name, email, and hashed password for login
-- to the external onboarding portal.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `pillars_candidate_registration` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `afid` varchar(100) NOT NULL,
  `candidate_name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `access_token` varchar(255) DEFAULT NULL,
  `access_expires_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `afid` (`afid`),
  INDEX idx_email (`email`),
  INDEX idx_deleted (`deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
