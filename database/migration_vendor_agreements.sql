USE crm_task_module;

-- ============================================================
-- Vendor Agreements Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Vendor Agreements table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_agreements (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         INT UNSIGNED NOT NULL,
  template_key      VARCHAR(50) NOT NULL DEFAULT 'master',
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  total_fee         DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_terms     VARCHAR(255) DEFAULT NULL,
  advance_payment   DECIMAL(12,2) NOT NULL DEFAULT 0,
  amc_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  services          JSON DEFAULT NULL,
  status            ENUM('Draft','Active','Expired','Terminated') NOT NULL DEFAULT 'Draft',
  notes             TEXT DEFAULT NULL,
  created_by        INT UNSIGNED NOT NULL,
  deleted           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_va_client  FOREIGN KEY (client_id)  REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_va_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Vendor Agreement Templates (7 templates: 6 services + 1 master)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_agreement_templates (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_key  VARCHAR(50) NOT NULL UNIQUE,
  label         VARCHAR(100) NOT NULL,
  description   VARCHAR(255) DEFAULT '',
  content       LONGTEXT NOT NULL,
  placeholders  JSON DEFAULT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed 7 default vendor agreement templates
INSERT INTO vendor_agreement_templates (template_key, label, description, content, placeholders) VALUES
('master', 'Master Agreement', 'General vendor agreement covering all services',
'<h1 style="text-align:center;">VENDOR SERVICE AGREEMENT</h1>
<p style="text-align:center;color:#555;">MASTER AGREEMENT</p>
<p>This Vendor Service Agreement ("Agreement") is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Address:</strong> {{company_address}}</p>
<p><strong>Client:</strong> {{client_name}}<br/><strong>Brand:</strong> {{client_brand}}</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider agrees to provide the following services: <strong>{{services}}</strong></p>
<h2>2. Term</h2>
<p>This Agreement shall commence on <strong>{{start_date}}</strong> and shall continue until <strong>{{end_date}}</strong>, unless terminated earlier in accordance with the terms herein.</p>
<h2>3. Fees & Payment</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance Payment:</strong> INR {{advance_payment}}<br/><strong>AMC (Annual Maintenance Charge):</strong> INR {{amc_amount}}</p>
<h2>4. Confidentiality</h2>
<p>Both parties agree to maintain confidentiality of all proprietary information shared during the course of this agreement.</p>
<h2>5. Termination</h2>
<p>Either party may terminate this Agreement by providing 30 days written notice. In case of breach, the non-breaching party may terminate immediately.</p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Authorized Signatory: _____________________<br/>Date: {{today}}</p>
<br/>
<p><strong>For {{client_name}}</strong><br/>Authorized Signatory: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","company_address","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]'),

('social_media_marketing', 'Social Media Marketing', 'Agreement for social media marketing services',
'<h1 style="text-align:center;">SOCIAL MEDIA MARKETING SERVICE AGREEMENT</h1>
<p>This Agreement is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Client:</strong> {{client_name}} ({{client_brand}})</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider shall provide Social Media Marketing services including but not limited to:</p>
<ul><li>Social media strategy development</li><li>Content creation and scheduling</li><li>Community management</li><li>Monthly analytics and reporting</li><li>Platform management (Instagram, Facebook, LinkedIn, Twitter)</li></ul>
<h2>2. Term</h2>
<p>From <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong></p>
<h2>3. Fees</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance:</strong> INR {{advance_payment}}<br/><strong>AMC:</strong> INR {{amc_amount}}</p>
<h2>4. Deliverables</h2>
<p>Monthly content calendar, creative posts, stories, reels, engagement reports.</p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>
<p><strong>For {{client_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]'),

('performance_marketing', 'Performance Marketing', 'Agreement for performance/paid ads marketing services',
'<h1 style="text-align:center;">PERFORMANCE MARKETING SERVICE AGREEMENT</h1>
<p>This Agreement is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Client:</strong> {{client_name}} ({{client_brand}})</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider shall provide Performance Marketing services including:</p>
<ul><li>Google Ads campaign management</li><li>Meta (Facebook/Instagram) Ads</li><li>Campaign strategy and optimization</li><li>A/B testing and conversion tracking</li><li>Monthly performance reports with ROI analysis</li></ul>
<h2>2. Term</h2>
<p>From <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong></p>
<h2>3. Fees</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance:</strong> INR {{advance_payment}}<br/><strong>AMC:</strong> INR {{amc_amount}}</p>
<p><em>Note: Ad spend budget is separate from service fees.</em></p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>
<p><strong>For {{client_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]'),

('seo', 'SEO', 'Agreement for Search Engine Optimization services',
'<h1 style="text-align:center;">SEO SERVICE AGREEMENT</h1>
<p>This Agreement is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Client:</strong> {{client_name}} ({{client_brand}})</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider shall provide SEO services including:</p>
<ul><li>Technical SEO audit and fixes</li><li>On-page optimization</li><li>Off-page SEO and link building</li><li>Keyword research and strategy</li><li>Monthly ranking and traffic reports</li></ul>
<h2>2. Term</h2>
<p>From <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong></p>
<h2>3. Fees</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance:</strong> INR {{advance_payment}}<br/><strong>AMC:</strong> INR {{amc_amount}}</p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>
<p><strong>For {{client_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]'),

('personal_branding', 'Personal Branding', 'Agreement for personal branding services',
'<h1 style="text-align:center;">PERSONAL BRANDING SERVICE AGREEMENT</h1>
<p>This Agreement is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Client:</strong> {{client_name}} ({{client_brand}})</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider shall provide Personal Branding services including:</p>
<ul><li>Personal brand strategy development</li><li>LinkedIn profile optimization and content</li><li>Thought leadership content creation</li><li>Public speaking and media coaching</li><li>Online reputation management</li></ul>
<h2>2. Term</h2>
<p>From <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong></p>
<h2>3. Fees</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance:</strong> INR {{advance_payment}}<br/><strong>AMC:</strong> INR {{amc_amount}}</p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>
<p><strong>For {{client_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]'),

('influencer_marketing', 'Influencer Marketing', 'Agreement for influencer marketing services',
'<h1 style="text-align:center;">INFLUENCER MARKETING SERVICE AGREEMENT</h1>
<p>This Agreement is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Client:</strong> {{client_name}} ({{client_brand}})</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider shall provide Influencer Marketing services including:</p>
<ul><li>Influencer identification and outreach</li><li>Campaign planning and execution</li><li>Content collaboration management</li><li>Performance tracking and reporting</li><li>Contract negotiation with influencers</li></ul>
<h2>2. Term</h2>
<p>From <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong></p>
<h2>3. Fees</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance:</strong> INR {{advance_payment}}<br/><strong>AMC:</strong> INR {{amc_amount}}</p>
<p><em>Note: Influencer fees/collaborations are billed separately.</em></p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>
<p><strong>For {{client_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]'),

('website_development', 'Website Development', 'Agreement for website development services',
'<h1 style="text-align:center;">WEBSITE DEVELOPMENT SERVICE AGREEMENT</h1>
<p>This Agreement is entered into on <strong>{{start_date}}</strong> between:</p>
<p><strong>Service Provider:</strong> {{company_name}}<br/><strong>Client:</strong> {{client_name}} ({{client_brand}})</p>
<h2>1. Scope of Services</h2>
<p>The Service Provider shall provide Website Development services including:</p>
<ul><li>UI/UX design and prototyping</li><li>Frontend and backend development</li><li>Responsive design implementation</li><li>CMS integration</li><li>Testing, deployment, and handover</li></ul>
<h2>2. Term</h2>
<p>From <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong></p>
<h2>3. Fees</h2>
<p><strong>Total Fee:</strong> INR {{total_fee}}<br/><strong>Payment Terms:</strong> {{payment_terms}}<br/><strong>Advance:</strong> INR {{advance_payment}}<br/><strong>AMC:</strong> INR {{amc_amount}}</p>
<h2>4. Deliverables</h2>
<p>Complete website with source code, documentation, and 30-day post-launch support.</p>
<hr/>
<p><strong>For {{company_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>
<p><strong>For {{client_name}}</strong><br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["client_name","client_brand","company_name","services","start_date","end_date","total_fee","payment_terms","advance_payment","amc_amount","today"]');
