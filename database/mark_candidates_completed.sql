-- Mark onboarding candidates as completed
-- Candidates: AFID0019 (Hariharan Pazhanivel), AFID0018 (S SIVARAJ)
-- Updates onboarding_status to 'completed' in pillars_candidate_details.

UPDATE `pillars_candidate_details`
SET
  `onboarding_status` = 'completed',
  `progress_percentage` = 100,
  `submitted_at` = COALESCE(`submitted_at`, NOW()),
  `updated_at` = NOW()
WHERE `afid` IN ('AFID0019', 'AFID0018')
  AND `deleted` = 0;

-- Verify the result
SELECT `afid`, `onboarding_status`, `progress_percentage`, `submitted_at`, `updated_at`
FROM `pillars_candidate_details`
WHERE `afid` IN ('AFID0019', 'AFID0018');
