-- Document Templates table
CREATE TABLE IF NOT EXISTS document_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_key VARCHAR(50) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  content LONGTEXT NOT NULL,
  placeholders JSON DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default templates
INSERT INTO document_templates (template_key, label, description, content, placeholders) VALUES
('appointment_letter', 'Appointment Letter', 'Official offer letter for new employees',
'<h1 style="text-align:center;">APPOINTMENT LETTER</h1>
<p style="text-align:center;color:#555;">GREETINGS FROM {{company_name}}</p>
<p>We are pleased to inform you that you have been appointed as <strong>{{designation}}</strong> at {{company_name}}, effective from <strong>{{date_of_joining}}</strong>. We believe your skills and dedication will be a valuable addition to our team.</p>
<p><strong>EMPLOYEE NAME:</strong> {{employee_name}}</p>
<p>Your employment will be governed by the following terms and conditions:</p>
<h2>1. Monthly Gross Salary</h2>
<p>You will receive a monthly gross salary of INR <strong>{{salary}}</strong>, inclusive of all allowances and benefits, as per company policy, and will be payable on the last day of every month via Bank Transfer. A detailed salary breakup will be shared separately.</p>
<h2>2. Working Hours</h2>
<p>Your standard working hours will be 9:00 AM to 6:00 PM, Monday to Saturday. Sundays will be weekly off unless otherwise required by project needs. You are expected to maintain punctuality and dedication to your role.</p>
<h2>3. Date of Appointment</h2>
<p>Your official appointment date is <strong>{{date_of_joining}}</strong>, as recorded in company records.</p>
<h2>4. Probation Period</h2>
<p>You will undergo a probation period of 3 months (90 days). After this period, your performance will be reviewed. Upon satisfactory performance, your employment will be confirmed. If not satisfactory, the probation may be extended.</p>
<h2>5. Notice Period</h2>
<p>During both probation and confirmed employment, either party may terminate this appointment by providing a 60-day written notice. Any leave taken during the notice period will extend the notice duration.</p>
<h2>6. Full-Time Employment</h2>
<p>This is a full-time position. You may not undertake any other employment, consultancy, or business activities without prior written approval from the company.</p>
<h2>7. Confidentiality</h2>
<p>You must maintain strict confidentiality of all company-related information, including but not limited to clients, projects, finances, and intellectual property, both during and after your employment.</p>
<hr/>
<p>Warm Regards,<br/><strong>Ramachandirane. A</strong><br/>Founder - {{company_name}}</p>
<br/><br/>
<p><strong>Employee Acknowledgment</strong></p>
<p>I hereby accept the terms and conditions outlined in this appointment letter.</p>
<p>Signature: _____________________</p>
<p>Name: {{employee_name}}</p>
<p>Date: {{today}}</p>',
'["employee_name","designation","date_of_joining","salary","company_name","today"]'),

('employment_bond', 'Employment Bond', 'Bond agreement with confidentiality & IP clauses',
'<h1 style="text-align:center;">EMPLOYMENT BOND AGREEMENT</h1>
<p style="text-align:center;font-size:11px;color:#555;">Including Confidentiality, Intellectual Property, Non-Solicitation & Code of Conduct Policies</p>
<p>This Employment Bond Agreement is made and executed on this <strong>{{today}}</strong> between:</p>
<p><strong>Company:</strong> {{company_name}}<br/><strong>Address:</strong> {{company_address}}</p>
<p><strong>Employee:</strong> {{employee_name}}<br/><strong>Designation:</strong> {{designation}}<br/><strong>Address:</strong> {{employee_address}}</p>
<h2>1. Appointment and Bond Duration</h2>
<p>The Employee is appointed for a minimum service period of 12 months from the date of joining, including a probation/training period of 3 months. The bond period shall commence from the Employee''s official date of joining. The Employee agrees not to voluntarily resign, discontinue employment, or terminate services during the bond period without prior approval from the Company.</p>
<h2>2. Notice Period</h2>
<p>During both the probationary and confirmed employment periods, either the Employee or the Company may terminate the employment by providing a 60-day written notice. Any leave taken during the notice period will result in an extension of the notice duration accordingly.</p>
<h2>3. Compensation</h2>
<p>The Employee shall receive salary, compensation, and benefits as mentioned in the Appointment Letter issued by the Company. The Company reserves the right to revise the compensation based on performance evaluation.</p>
<h2>4. Bond Violation and Recovery</h2>
<p>If the Employee resigns, abandons employment, breaches the terms of this Agreement, or leaves the Company before completion of the bond period, the Employee shall be liable to pay an amount equivalent to three (3) months'' gross salary as bond compensation or recovery charges.</p>
<h2>5. Confidentiality & Intellectual Property</h2>
<p>All work, software, code, content, campaigns, designs, documents, concepts, or materials created during employment shall remain the exclusive property of {{company_name}}. The Employee shall not disclose, share, or misuse any Confidential Information.</p>
<h2>6. Non-Solicitation</h2>
<p>During employment and for a period of 12 months after termination, the Employee shall not solicit the Company''s clients, vendors, partners, or employees for competing business activities.</p>
<hr/>
<p><strong>Employee Signature</strong></p>
<p>Name: {{employee_name}}<br/>Signature: _____________________<br/>Date: {{today}}</p>
<br/>
<p><strong>Authorized Signatory</strong></p>
<p>For {{company_name}}<br/>Signature: _____________________<br/>Date: {{today}}</p>',
'["employee_name","designation","date_of_joining","employee_address","company_name","company_address","today"]'),

('rule_book', 'Rule Book', 'Company workplace policies & code of conduct',
'<h1 style="text-align:center;">RULE BOOK</h1>
<h2>1. Working Schedule & Office Hours</h2>
<p><strong>Working Days:</strong> Monday to Saturday<br/><strong>Working Hours (Mon–Fri):</strong> 9:00 AM to 6:00 PM<br/><strong>Lunch Break:</strong> 1:00 PM to 2:00 PM<br/><strong>Saturday:</strong> 9:00 AM to 1:30 PM</p>
<p><strong>Grace Period:</strong> Employees are allowed a maximum grace period of 10 minutes. This must be compensated during evening working hours. Continuous use for 3–4 days may result in 1 day LOP. Using grace time more than 7 times in a month may also lead to 1 day LOP.</p>
<h2>2. Attendance & Task Tracking</h2>
<p>Employees are required to mark attendance daily and maintain accurate task updates through the company CRM system. Failure to update tasks, repeated absenteeism, or irregular attendance may affect performance evaluation.</p>
<h2>3. Leave Policy</h2>
<p>Employees are eligible for 1 paid leave per month, subject to approval. All leave requests must be approved in advance. During probation, leave only for valid emergencies. No permissions are permitted.</p>
<h2>4. Dress Code</h2>
<p>Formal attire is mandatory on all six working days. Casual wear is strictly discouraged within office premises.</p>
<h2>5. Workplace Behavior</h2>
<p>Discrimination, harassment, abusive language, offensive conduct, and unprofessional arguments are strictly prohibited. Employees must contribute to a healthy, respectful, and productive work environment.</p>
<h2>6. Mobile Phones & Internet</h2>
<p>Mobile phones must remain on silent mode. Personal calls should be avoided except during emergencies. Company systems must be used strictly for official business purposes.</p>
<h2>7. Headphones & Music</h2>
<p>The use of headphones or music during office hours is not permitted unless specifically approved by management for work-related purposes.</p>
<h2>8. Notice Period</h2>
<p>Either party may terminate employment by providing a 60-day written notice. Leave taken during notice period will extend the duration.</p>
<h2>9. Confidentiality & IP</h2>
<p>All company data, client information, and strategies are strictly confidential. Any work created during employment is the exclusive intellectual property of {{company_name}}.</p>
<h2>10. Freelancing & Conflict of Interest</h2>
<p>Employees are not permitted to engage in freelance or competing business activities without written approval from management.</p>
<hr/>
<p><strong>Employee Acknowledgement</strong></p>
<p>I have read, understood, and agreed to comply with the company''s Code of Conduct and Workplace Policies.</p>
<p>Employee Name: {{employee_name}}<br/>Signature: ___________________________<br/>Date: {{today}}</p>',
'["employee_name","company_name","today"]'),

('exit_noc', 'Exit NOC', 'Clearance & No Objection Certificate',
'<h1 style="text-align:center;">Employee Exit Clearance & No Objection Certificate (NOC)</h1>
<h2>1. Employee Information</h2>
<table style="width:100%;border-collapse:collapse;"><tr><td style="border:1px solid #ccc;padding:6px;"><strong>Employee Name</strong></td><td style="border:1px solid #ccc;padding:6px;">{{employee_name}}</td></tr><tr><td style="border:1px solid #ccc;padding:6px;"><strong>Designation</strong></td><td style="border:1px solid #ccc;padding:6px;">{{designation}}</td></tr><tr><td style="border:1px solid #ccc;padding:6px;"><strong>Department</strong></td><td style="border:1px solid #ccc;padding:6px;">{{department}}</td></tr><tr><td style="border:1px solid #ccc;padding:6px;"><strong>Date of Joining</strong></td><td style="border:1px solid #ccc;padding:6px;">{{date_of_joining}}</td></tr><tr><td style="border:1px solid #ccc;padding:6px;"><strong>Last Working Date</strong></td><td style="border:1px solid #ccc;padding:6px;">{{last_working_date}}</td></tr><tr><td style="border:1px solid #ccc;padding:6px;"><strong>Separation Type</strong></td><td style="border:1px solid #ccc;padding:6px;">{{separation_type}}</td></tr></table>
<h2>2. Knowledge Transfer & Handover</h2>
<table style="width:100%;border-collapse:collapse;"><tr><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Particulars</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Status</th></tr><tr><td style="border:1px solid #ccc;padding:6px;">Project Handover Completed</td><td style="border:1px solid #ccc;padding:6px;">☐ Yes ☐ No</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">Credentials/Documents Shared</td><td style="border:1px solid #ccc;padding:6px;">☐ Yes ☐ No</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">Pending Tasks Updated</td><td style="border:1px solid #ccc;padding:6px;">☐ Yes ☐ No</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">Client Communication Completed</td><td style="border:1px solid #ccc;padding:6px;">☐ Yes ☐ No</td></tr></table>
<h2>3. Company Asset Return</h2>
<table style="width:100%;border-collapse:collapse;"><tr><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Asset</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Return Status</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Condition</th></tr><tr><td style="border:1px solid #ccc;padding:6px;">Laptop / Desktop</td><td style="border:1px solid #ccc;padding:6px;">☐ Returned ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">☐ Good ☐ Damaged</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">Mobile Phone</td><td style="border:1px solid #ccc;padding:6px;">☐ Returned ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">☐ Good ☐ Damaged</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">ID Card</td><td style="border:1px solid #ccc;padding:6px;">☐ Returned ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">☐ Good ☐ Damaged</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">Charger / Accessories</td><td style="border:1px solid #ccc;padding:6px;">☐ Returned ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">☐ Good ☐ Damaged</td></tr></table>
<h2>4. Department Clearance</h2>
<table style="width:100%;border-collapse:collapse;"><tr><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Department</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Status</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5;">Signature</th></tr><tr><td style="border:1px solid #ccc;padding:6px;">Reporting Manager</td><td style="border:1px solid #ccc;padding:6px;">☐ Cleared ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">__________</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">HR Department</td><td style="border:1px solid #ccc;padding:6px;">☐ Cleared ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">__________</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">Accounts & Finance</td><td style="border:1px solid #ccc;padding:6px;">☐ Cleared ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">__________</td></tr><tr><td style="border:1px solid #ccc;padding:6px;">IT / Admin</td><td style="border:1px solid #ccc;padding:6px;">☐ Cleared ☐ Pending</td><td style="border:1px solid #ccc;padding:6px;">__________</td></tr></table>
<hr/>
<p><strong>Employee Declaration</strong></p>
<p>I confirm that all company assets, documents, credentials, and responsibilities have been properly handed over.</p>
<p>Employee Signature: ____________________ &nbsp; Date: {{today}}</p>
<br/>
<p><strong>HR Final Clearance & NOC</strong></p>
<p>This is to certify that {{employee_name}} has completed all required exit formalities and departmental clearances. The organization has no objection to future employment opportunities.</p>
<p>Authorized HR Signature: ____________________ &nbsp; Date: ____________</p>',
'["employee_name","designation","department","date_of_joining","last_working_date","separation_type","company_name","today"]'),

('experience_cert', 'Experience Certificate', 'Employment tenure certification',
'<h1 style="text-align:center;">EXPERIENCE CERTIFICATE</h1>
<p style="text-align:right;">Date: {{today}}</p>
<p style="text-align:center;font-weight:bold;">TO WHOMSOEVER IT MAY CONCERN</p>
<br/>
<p>This is to certify that <strong>{{employee_name}}</strong> was employed with <strong>{{company_name}}</strong> as a <strong>{{designation}}</strong> from <strong>{{from_date}}</strong> to <strong>{{to_date}}</strong>.</p>
<p>During the course of employment, the employee was associated with various responsibilities related to project coordination, client communication, operational support, and task management. They consistently demonstrated professionalism, commitment, and the ability to handle responsibilities effectively within the organization.</p>
<p>Throughout their tenure, they exhibited strong communication skills, adaptability, teamwork, and a proactive approach toward assigned tasks. Their contribution supported the successful execution of multiple organizational objectives and day-to-day operations.</p>
<p>We found <strong>{{employee_name}}</strong> to be sincere, hardworking, and professional in their conduct during their association with the company.</p>
<p>We appreciate their contributions and wish them continued success in all future professional endeavours.</p>
<br/><br/>
<p>For <strong>{{company_name}}</strong></p>
<p>Authorized Signatory</p>
<br/>
<p>Signature & Company Seal</p>
<br/>
<p><strong>(RAMACHANDIRAN)</strong></p>',
'["employee_name","designation","from_date","to_date","company_name","today"]');
