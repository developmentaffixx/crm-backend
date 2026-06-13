-- Sales Plan migration
-- Stores the sales plan targets that Admin can edit; all users can view

CREATE TABLE IF NOT EXISTS sales_plan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section VARCHAR(50) NOT NULL,         -- 'monthly_target', 'daily_target', 'outreach_breakdown', 'call_breakdown', 'industry_focus_day', 'industry_daywise_split', 'weekly_industry_target'
  data JSON NOT NULL,                   -- Flexible JSON to store rows of the section
  updated_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_section (section)
);

-- Seed default data
INSERT INTO sales_plan (section, data) VALUES
('monthly_target', '[{"activity":"Leads","target":"800"},{"activity":"Outreach","target":"800"},{"activity":"Calls","target":"195+"},{"activity":"Follow-Ups","target":"300–400"},{"activity":"Interested Leads","target":"30–50"},{"activity":"Meetings","target":"15–25"},{"activity":"Proposals","target":"8–15"},{"activity":"Client Closures","target":"3–5"},{"activity":"Revenue","target":"₹1.5L–₹2L"}]'),
('daily_target', '[{"activity":"Leads Added","target":"60"},{"activity":"Outreach Sent","target":"60"},{"activity":"Calls Made","target":"15"},{"activity":"Follow-Ups Completed","target":"20–30"},{"activity":"Interested Leads","target":"2–3"},{"activity":"Meetings Booked","target":"1–2"},{"activity":"Proposals Sent","target":"1 every 1–2 days"},{"activity":"CRM Updates","target":"Mandatory"},{"activity":"Daily Report Submission","target":"Mandatory"}]'),
('outreach_breakdown', '[{"platform":"WhatsApp","target":"25"},{"platform":"Instagram","target":"15"},{"platform":"Email","target":"10"},{"platform":"LinkedIn","target":"10"},{"platform":"Total","target":"60"}]'),
('call_breakdown', '[{"call_type":"New Cold Calls","target":"10"},{"call_type":"Follow-Up Calls","target":"5"},{"call_type":"Total Calls","target":"15"}]'),
('industry_focus_day', '[{"focus_day":"Clothing Focus Day","clothing":"40","restaurant":"10","education":"5","real_estate":"5","total":"60"},{"focus_day":"Restaurant Focus Day","clothing":"10","restaurant":"40","education":"5","real_estate":"5","total":"60"},{"focus_day":"Education Focus Day","clothing":"10","restaurant":"5","education":"40","real_estate":"5","total":"60"},{"focus_day":"Real Estate Focus Day","clothing":"15","restaurant":"10","education":"5","real_estate":"30","total":"60"}]'),
('industry_daywise_split', '[{"day":"Monday","primary_focus":"Clothing","clothing":"40","restaurant":"10","education":"5","real_estate":"5","total":"60"},{"day":"Tuesday","primary_focus":"Restaurant","clothing":"10","restaurant":"40","education":"5","real_estate":"5","total":"60"},{"day":"Wednesday","primary_focus":"Education","clothing":"10","restaurant":"5","education":"40","real_estate":"5","total":"60"},{"day":"Thursday","primary_focus":"Real Estate","clothing":"15","restaurant":"10","education":"5","real_estate":"30","total":"60"},{"day":"Friday","primary_focus":"Mixed Focus","clothing":"20","restaurant":"20","education":"10","real_estate":"10","total":"60"},{"day":"Saturday (Half Day)","primary_focus":"Follow-Ups & Hot Leads & New leads","clothing":"5","restaurant":"5","education":"5","real_estate":"5","total":"20"}]'),
('weekly_industry_target', '[{"industry":"Clothing","total_leads":"100"},{"industry":"Restaurant","total_leads":"90"},{"industry":"Education","total_leads":"70"},{"industry":"Real Estate","total_leads":"60"},{"industry":"Total","total_leads":"320"}]')
ON DUPLICATE KEY UPDATE section = section;
