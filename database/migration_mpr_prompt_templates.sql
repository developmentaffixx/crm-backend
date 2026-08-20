-- Migration: MPR Prompt Templates
-- Admin-configurable AI prompt templates for monthly report generation

CREATE TABLE IF NOT EXISTS mpr_prompt_templates (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  description VARCHAR(500) DEFAULT NULL COMMENT 'Short description shown to user when selecting',
  prompt_body TEXT NOT NULL COMMENT 'The AI prompt with {{placeholders}} for report data',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed 2 default prompt templates

INSERT INTO mpr_prompt_templates (name, description, prompt_body, sort_order) VALUES
(
  'Professional & Detailed',
  'Generates a formal, data-rich report with full analysis paragraphs and insights',
  'You are a senior social media marketing strategist creating a monthly performance report presentation for a client.\n\nProject: {{project_name}}\nClient: {{client_name}}\nMonth: {{month}}\nPlatform(s): {{platforms}}\n\n--- DATA PROVIDED ---\n\nContent Published:\n{{content_overview}}\n\nAccount Performance:\n{{account_performance}}\n\nTop Performing Posts:\n{{most_viewed_posts}}\n\nMeta Ads Campaign Results:\n{{ads_campaigns}}\n\nAudience Demographics:\n{{audience_demographics}}\n\nRecommendations (raw points):\n{{recommendations}}\n\n--- INSTRUCTIONS ---\n\nGenerate a professional monthly performance report with the following slides. Write in a confident, data-driven tone. Use specific numbers from the data provided. Each section should be 3-5 sentences minimum.\n\nReturn ONLY valid JSON in this exact format:\n{\n  \"executive_summary\": \"(3-4 paragraphs covering: what was done, key results, content strategy insights, overall growth)\",\n  \"content_analysis\": \"(paragraph analyzing content performance, what types worked best, consistency)\",\n  \"post_analysis\": [\"(detailed analysis for each top post - what worked, why, audience response)\"],\n  \"performance_insights\": \"(paragraph interpreting account performance numbers, growth trends, engagement patterns)\",\n  \"ads_conclusion\": \"(paragraph summarizing ad campaign results, ROI, what worked)\",\n  \"demographic_insights\": \"(paragraph about audience composition, geographic reach, age/gender insights)\",\n  \"recommendations_polished\": [\"(each recommendation rewritten as a clear, actionable sentence)\"],\n  \"conclusion\": \"(2-3 paragraphs summarizing overall growth, key takeaways, direction for next month)\"\n}',
  1
),
(
  'Short & Crisp',
  'Generates concise bullet-point style content — quick read, straight to the point',
  'You are a social media marketing expert creating a concise monthly report summary for a client.\n\nProject: {{project_name}}\nClient: {{client_name}}\nMonth: {{month}}\nPlatform(s): {{platforms}}\n\n--- DATA PROVIDED ---\n\nContent Published:\n{{content_overview}}\n\nAccount Performance:\n{{account_performance}}\n\nTop Performing Posts:\n{{most_viewed_posts}}\n\nMeta Ads Campaign Results:\n{{ads_campaigns}}\n\nAudience Demographics:\n{{audience_demographics}}\n\nRecommendations (raw points):\n{{recommendations}}\n\n--- INSTRUCTIONS ---\n\nGenerate a SHORT, CRISP monthly report. Use bullet points where possible. Keep each section to 2-3 lines maximum. Be direct — no fluff.\n\nReturn ONLY valid JSON in this exact format:\n{\n  \"executive_summary\": \"(2-3 short sentences — what was done, key highlight, overall result)\",\n  \"content_analysis\": \"(1-2 sentences on content performance)\",\n  \"post_analysis\": [\"(1 sentence per top post — views, reach, key metric)\"],\n  \"performance_insights\": \"(2-3 bullet points on account growth)\",\n  \"ads_conclusion\": \"(1-2 sentences on ad results and ROI)\",\n  \"demographic_insights\": \"(1 sentence on audience)\",\n  \"recommendations_polished\": [\"(short actionable bullet points)\"],\n  \"conclusion\": \"(2-3 sentences — summary and next month focus)\"\n}',
  2
);
