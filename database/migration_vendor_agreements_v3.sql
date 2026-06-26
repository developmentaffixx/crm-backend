USE crm_task_module;

-- ============================================================
-- Vendor Agreements v3 - Enhanced SMM Template + New Fields
-- ============================================================

-- Add new columns to vendor_agreements table
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS client_contact VARCHAR(50) DEFAULT NULL AFTER client_id;
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS client_address TEXT DEFAULT NULL AFTER client_contact;
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS platforms VARCHAR(500) DEFAULT NULL AFTER services;
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS monthly_creatives VARCHAR(255) DEFAULT NULL AFTER platforms;
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS payment_milestones JSON DEFAULT NULL AFTER advance_payment;
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS onboarding_start DATE DEFAULT NULL AFTER end_date;
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS onboarding_end DATE DEFAULT NULL AFTER onboarding_start;

-- ============================================================
-- Update Social Media Marketing template with detailed structure
-- ============================================================
UPDATE vendor_agreement_templates SET content = '<h1 style="text-align:center;">SOCIAL MEDIA MARKETING SERVICE AGREEMENT</h1>
<p style="text-align:center;"><strong>Agreement Date:</strong> {{today}}</p>
<p>This Social Media Marketing Service Agreement ("Agreement") is entered into on <strong>{{today}}</strong> between:</p>

<h2>SERVICE PROVIDER</h2>
<p><strong>{{company_name}}</strong><br/>Office Address: {{company_address}}<br/>Contact Number: {{company_contact}}</p>
<p>Hereinafter referred to as the "Service Provider."</p>

<h2>CLIENT</h2>
<p><strong>{{client_name}}</strong><br/>Proprietor – {{client_brand}}<br/>Business Address: {{client_address}}<br/>Contact Number: {{client_contact}}</p>
<p>Hereinafter referred to as the "Client."</p>
<p>The Service Provider and the Client shall collectively be referred to as the "Parties" and individually as a "Party."</p>

<hr/>

<h2>1. Purpose of Engagement</h2>
<p>The Client appoints {{company_name}} to provide Social Media Marketing Services for <strong>{{client_brand}}</strong> with the objective of strengthening the brand''s digital presence, increasing visibility across the agreed social media platforms, building meaningful audience engagement, generating genuine customer enquiries, and supporting increased customer footfall through strategic content creation, platform management, and marketing activities.</p>

<h2>2. Agreement Term</h2>
<table style="width:100%;border-collapse:collapse;">
<tr><td style="border:1px solid #ccc;padding:8px;"><strong>Agreement Date</strong></td><td style="border:1px solid #ccc;padding:8px;">{{today}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;"><strong>Planning & Onboarding</strong></td><td style="border:1px solid #ccc;padding:8px;">{{onboarding_start}} – {{onboarding_end}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;"><strong>Service Period</strong></td><td style="border:1px solid #ccc;padding:8px;">{{start_date}} – {{end_date}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;"><strong>Contract Duration</strong></td><td style="border:1px solid #ccc;padding:8px;">{{contract_duration}}</td></tr>
</table>
<p>The planning and onboarding period shall be utilized for project discussions, account setup, content planning, creative preparation, platform access, and strategy development prior to the commencement of active service delivery.</p>

<h2>3. Service Scope</h2>
<p>{{company_name}} shall provide the following services throughout the Agreement period.</p>
<table style="width:100%;border-collapse:collapse;">
<tr><th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;">Service</th><th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;">Included</th></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Platforms</td><td style="border:1px solid #ccc;padding:8px;">{{platforms}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Social Media Setup</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Content Creation</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Monthly Content Calendar</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Monthly Creatives</td><td style="border:1px solid #ccc;padding:8px;">{{monthly_creatives}}</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Community Management</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Monthly Insight Report</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Meta Ads Management</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Ad Budget Included</td><td style="border:1px solid #ccc;padding:8px;">No</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Video & Photo Shoot</td><td style="border:1px solid #ccc;padding:8px;">One session</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Monthly Strategy Call</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
<tr><td style="border:1px solid #ccc;padding:8px;">Priority Support</td><td style="border:1px solid #ccc;padding:8px;">Yes</td></tr>
</table>
<p>The above scope represents the services included within the agreed commercial value. Any additional services requested outside this scope shall be subject to mutual agreement and may attract additional charges.</p>

<h2>4. Commercial Terms</h2>
<p><strong>Total Contract Value: ₹{{total_fee}}</strong> ({{total_fee_words}})</p>
<h3>Payment Schedule</h3>
{{payment_milestones_table}}

<p>Payments shall be made on or before the due dates mentioned above.</p>

<h2>5. Terms & Conditions</h2>
<h3>Client Responsibilities</h3>
<p>The Client agrees to:</p>
<ul>
<li>Provide access to all required social media accounts and platforms (if exists).</li>
<li>Share accurate business information, products, offers, images, and other materials required for content creation.</li>
<li>Review and approve content within one (1) business day of submission.</li>
<li>Provide timely feedback to avoid delays in execution.</li>
<li>Ensure that all information supplied to {{company_name}} is accurate and legally compliant.</li>
</ul>
<p>Delays in approvals or required information may result in corresponding adjustments to the content schedule and service timelines.</p>

<h2>6. Payment Terms</h2>
<p>The Client agrees to make payments as per the agreed payment schedule.</p>
<p>If any payment remains overdue, {{company_name}} reserves the right to temporarily pause content publishing, campaign management, or other related services until the outstanding payment is received.</p>
<p>Any delay caused by pending payments or delayed approvals shall automatically extend the applicable project timelines.</p>
<p>Payments made for services already performed shall be non-refundable.</p>

<h2>7. Intellectual Property</h2>
<p>All trademarks, logos, brand assets, business information, and materials provided by the Client shall remain the property of the Client.</p>
<p>Upon receipt of full payment, the final approved content created specifically for the Client under this Agreement shall become the property of the Client.</p>
<p>{{company_name}} shall retain ownership of its internal templates, creative frameworks, methodologies, systems, strategies, processes, reporting formats, and operational know-how.</p>

<h2>8. Showcase Rights</h2>
<p>The Client grants {{company_name}} the non-exclusive right to display and reference the Client''s brand name, logo, approved creatives, photographs, videos, campaign materials, and publicly available project outcomes for the purpose of showcasing {{company_name}}''s work across its website, social media platforms, presentations, proposals, case studies, and other promotional or marketing materials.</p>
<p>{{company_name}} shall not disclose any confidential or commercially sensitive information belonging to the Client without prior written consent.</p>
<p>If the Client requests in writing that the engagement remain confidential, {{company_name}} shall honour such request and refrain from publicly showcasing the project.</p>

<h2>9. Confidentiality</h2>
<p>Both Parties agree to maintain the confidentiality of any non-public business information shared during the course of this engagement and shall not disclose such information to any third party without prior written consent, unless required by law.</p>

<h2>10. Performance Expectations</h2>
<p>{{company_name}} shall professionally plan, create, manage, and optimize the Client''s social media presence with the objective of increasing brand visibility, strengthening digital presence, generating genuine customer enquiries, and supporting increased customer footfall through strategic social media marketing.</p>
<p>The Client acknowledges that the effectiveness of digital marketing depends on several factors beyond the reasonable control of {{company_name}}, including product quality, pricing, customer experience, market conditions, competition, seasonal demand, platform algorithms, customer behaviour, and advertising budget.</p>
<p>Accordingly, while {{company_name}} will apply commercially reasonable efforts, industry best practices, and its professional expertise to achieve the agreed marketing objectives, it does not guarantee any specific number of enquiries, sales, revenue, customer footfall, followers, engagement, reach, or other business outcomes.</p>

<h2>11. Termination</h2>
<p>This Agreement shall remain valid for the agreed term unless terminated earlier by mutual written consent.</p>
<p>If the Client terminates this Agreement before completion of the agreed term:</p>
<ul>
<li>All completed work shall remain chargeable.</li>
<li>Any outstanding invoices shall remain immediately payable.</li>
<li>No refund shall be applicable for services already delivered.</li>
</ul>
<p>{{company_name}} reserves the right to suspend or terminate services in the event of non-payment or any material breach of this Agreement.</p>

<h2>12. Governing Law</h2>
<p>This Agreement shall be governed by and interpreted in accordance with the laws of India.</p>
<p>Any disputes arising out of this Agreement shall be subject to the exclusive jurisdiction of the competent courts in Puducherry.</p>

<h2>13. Acceptance & Signatures</h2>
<p>By signing below, both Parties acknowledge that they have read, understood, and agreed to the terms and conditions contained in this Agreement.</p>

<h3>FOR THE CLIENT</h3>
<p><strong>{{client_name}}</strong><br/>Proprietor – {{client_brand}}</p>
<p>Signature: _____________________</p>
<p>Date: _____________________</p>

<br/>

<h3>FOR {{company_name}}</h3>
<p><strong>{{company_signatory}}</strong><br/>{{company_signatory_title}}</p>
<p>Signature: _____________________</p>
<p>Date: _____________________</p>',
placeholders = '["client_name","client_brand","client_address","client_contact","company_name","company_address","company_contact","company_signatory","company_signatory_title","platforms","monthly_creatives","start_date","end_date","onboarding_start","onboarding_end","contract_duration","total_fee","total_fee_words","payment_milestones_table","advance_payment","amc_amount","today"]'
WHERE template_key = 'social_media_marketing';
