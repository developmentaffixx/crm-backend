const db = require('../config/db');

// ─── Helper: Generate Vendor Agreement ID (VAG-YY-###) ────────────────────────
// Sequence never resets (per system rules: Client/Employee → never reset)
async function generateAgreementId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `VAG-${yy}`;

  // Count all agreements this year to get next sequence
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM vendor_agreements WHERE YEAR(created_at) = YEAR(CURDATE()) AND agreement_id IS NOT NULL`
  );
  const seq = String((rows[0]?.cnt || 0) + 1).padStart(3, '0');
  return `${prefix}-${seq}`;
}

// ─── Services list (fixed options) ────────────────────────────────────────────
const SERVICE_OPTIONS = [
  'Social Media Marketing',
  'Performance Marketing',
  'SEO',
  'Personal Branding',
  'Influencer Marketing',
  'Website Development',
];

// ─── LIST all vendor agreements ───────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { search } = req.query;
    let where = 'va.deleted = 0';
    const params = [];

    if (search) {
      where += ' AND (l.name LIKE ? OR l.business_name LIKE ? OR va.template_key LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT va.*,
              l.name AS client_name,
              l.business_name AS client_brand,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM vendor_agreements va
       INNER JOIN (
         SELECT client_id, MAX(id) AS latest_id
         FROM vendor_agreements
         WHERE deleted = 0
         GROUP BY client_id
       ) latest ON va.id = latest.latest_id
       LEFT JOIN leads l ON l.id = va.client_id
       LEFT JOIN users u ON u.id = va.created_by
       WHERE ${where}
       ORDER BY va.created_at DESC`,
      params
    );

    return res.json({ agreements: rows });
  } catch (err) {
    console.error('Client agreements list error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── GET single agreement ─────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT va.*,
              l.name AS client_name,
              l.business_name AS client_brand,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM vendor_agreements va
       LEFT JOIN leads l ON l.id = va.client_id
       LEFT JOIN users u ON u.id = va.created_by
       WHERE va.id = ? AND va.deleted = 0`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Agreement not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Vendor agreement getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE agreement ─────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      client_id, template_key, start_date, end_date,
      total_fee, payment_terms, advance_payment, amc_amount,
      services
    } = req.body;

    if (!client_id || !start_date || !end_date) {
      return res.status(400).json({ message: 'Client, start date, and end date are required' });
    }

    // Generate agreement_id
    const agreement_id = await generateAgreementId();

    const [result] = await db.query(
      `INSERT INTO vendor_agreements
        (agreement_id, client_id, template_key, start_date, end_date, total_fee, payment_terms, advance_payment, amc_amount, services, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agreement_id,
        client_id,
        template_key || 'master',
        start_date,
        end_date,
        total_fee || 0,
        payment_terms || null,
        advance_payment || 0,
        amc_amount || 0,
        JSON.stringify(services || []),
        'Active',
        req.user.id,
      ]
    );

    return res.status(201).json({ message: 'Agreement created', id: result.insertId, agreement_id });
  } catch (err) {
    console.error('Vendor agreement create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UPDATE agreement ─────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const {
      client_id, template_key, start_date, end_date,
      total_fee, payment_terms, advance_payment, amc_amount,
      services
    } = req.body;

    const [result] = await db.query(
      `UPDATE vendor_agreements SET
        client_id = ?, template_key = ?, start_date = ?, end_date = ?,
        total_fee = ?, payment_terms = ?, advance_payment = ?, amc_amount = ?,
        services = ?
       WHERE id = ? AND deleted = 0`,
      [
        client_id,
        template_key || 'master',
        start_date,
        end_date,
        total_fee || 0,
        payment_terms || null,
        advance_payment || 0,
        amc_amount || 0,
        JSON.stringify(services || []),
        req.params.id,
      ]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Agreement not found' });
    return res.json({ message: 'Agreement updated' });
  } catch (err) {
    console.error('Vendor agreement update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE agreement (soft) ──────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE vendor_agreements SET deleted = 1 WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Agreement not found' });
    return res.json({ message: 'Agreement deleted' });
  } catch (err) {
    console.error('Vendor agreement delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── TEMPLATES: List all vendor agreement templates ───────────────────────────
exports.listTemplates = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, template_key, label, description, placeholders, updated_at FROM vendor_agreement_templates ORDER BY id'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Vendor agreement templates list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── TEMPLATES: Get single template by key ────────────────────────────────────
exports.getTemplate = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM vendor_agreement_templates WHERE template_key = ?',
      [req.params.key]
    );
    if (!rows.length) return res.status(404).json({ message: 'Template not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Vendor agreement template get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── TEMPLATES: Update template content ───────────────────────────────────────
exports.updateTemplate = async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Content is required' });

    const [result] = await db.query(
      'UPDATE vendor_agreement_templates SET content = ?, updated_at = NOW() WHERE template_key = ?',
      [content, req.params.key]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Template not found' });
    return res.json({ message: 'Template updated successfully' });
  } catch (err) {
    console.error('Vendor agreement template update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GENERATE PDF from agreement data ─────────────────────────────────────────
exports.generate = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');

    const { agreement_id } = req.body;

    if (!agreement_id) {
      return res.status(400).json({ message: 'Agreement ID is required' });
    }

    // Fetch agreement
    const [agreements] = await db.query(
      `SELECT va.*,
              l.name AS client_name,
              l.business_name AS client_brand
       FROM vendor_agreements va
       LEFT JOIN leads l ON l.id = va.client_id
       WHERE va.id = ? AND va.deleted = 0`,
      [agreement_id]
    );

    if (!agreements.length) return res.status(404).json({ message: 'Agreement not found' });
    const agreement = agreements[0];

    // Fetch company info
    const [companies] = await db.query('SELECT * FROM company_settings LIMIT 1');
    const company = companies[0] || {};

    const companyName = company.company_name || '';
    const companyAddress = [company.address_line1, company.address_line2, company.city, company.state].filter(Boolean).join(', ');

    // Format dates
    const fmtDate = (d) => {
      if (!d) return '';
      const date = new Date(d);
      return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    };

    const today = fmtDate(new Date());

    // Parse services
    let services = [];
    if (agreement.services) {
      try {
        const parsed = JSON.parse(agreement.services);
        services = Array.isArray(parsed) ? parsed.map(s => typeof s === 'string' ? { name: s, fee: '' } : s) : [];
      } catch (e) {
        console.error('Failed to parse services JSON:', e.message);
        services = [];
      }
    }
    const serviceNames = services.map(s => s.name).join(', ');

    // Build replacements
    const replacements = {
      '{{client_name}}': agreement.client_name || '',
      '{{client_brand}}': agreement.client_brand || '',
      '{{company_name}}': companyName,
      '{{company_address}}': companyAddress,
      '{{services}}': serviceNames,
      '{{start_date}}': fmtDate(agreement.start_date),
      '{{end_date}}': fmtDate(agreement.end_date),
      '{{total_fee}}': agreement.total_fee ? Number(agreement.total_fee).toLocaleString('en-IN') : '0',
      '{{payment_terms}}': agreement.payment_terms || '',
      '{{advance_payment}}': agreement.advance_payment ? Number(agreement.advance_payment).toLocaleString('en-IN') : '0',
      '{{amc_amount}}': agreement.amc_amount ? Number(agreement.amc_amount).toLocaleString('en-IN') : '0',
      '{{today}}': today,
    };

    const applyReplacements = (text) => {
      for (const [key, value] of Object.entries(replacements)) {
        text = text.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
      }
      return text;
    };

    // Fetch master template
    let masterTemplates = [];
    try {
      [masterTemplates] = await db.query(
        'SELECT * FROM vendor_agreement_templates WHERE template_key = ?',
        ['master']
      );
    } catch (dbErr) {
      console.error('vendor_agreement_templates query failed:', dbErr.message);
      return res.status(500).json({ message: 'Agreement templates not found. Please run the database migration.' });
    }

    // ─── Build PDF with PDFKit ────────────────────────────────────────────────
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 50, right: 50 } });

    // Collect PDF into buffer
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    const pdfReady = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Add letterhead background if available (fetched from Cloudinary URL)
    let letterheadBuffer = null;
    if (company.letterhead_url) {
      try {
        const letterheadUrl = company.letterhead_url;
        // Check if it's a URL (Cloudinary) or local path
        if (letterheadUrl.startsWith('http')) {
          const https = require('https');
          const http = require('http');
          letterheadBuffer = await new Promise((resolve, reject) => {
            const client = letterheadUrl.startsWith('https') ? https : http;
            client.get(letterheadUrl, (resp) => {
              const chunks = [];
              resp.on('data', chunk => chunks.push(chunk));
              resp.on('end', () => resolve(Buffer.concat(chunks)));
              resp.on('error', reject);
            }).on('error', reject);
          });
        } else {
          const letterheadPath = path.join(__dirname, '../../', letterheadUrl);
          if (fs.existsSync(letterheadPath)) {
            letterheadBuffer = fs.readFileSync(letterheadPath);
          }
        }
      } catch (imgErr) {
        console.error('Failed to load letterhead image:', imgErr.message);
      }
    }

    // Function to add letterhead as full-page background on the current page
    const addLetterheadBg = () => {
      if (letterheadBuffer) {
        try {
          doc.image(letterheadBuffer, 0, 0, { width: 595.28, height: 841.89 });
        } catch {}
      }
    };

    // Add letterhead on first page
    addLetterheadBg();
    doc.y = 120; // Start content below letterhead header area

    // Listen for new pages to add letterhead background
    doc.on('pageAdded', () => {
      addLetterheadBg();
      doc.y = 120;
    });

    // Helper functions for PDF content
    const addTitle = (text) => {
      doc.fontSize(16).font('Helvetica-Bold').text(text, { align: 'center' });
      doc.moveDown(0.5);
    };

    const addSubtitle = (text) => {
      doc.fontSize(10).font('Helvetica').fillColor('#555555').text(text, { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(1);
    };

    const addHeading = (text) => {
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica-Bold').text(text);
      doc.moveDown(0.3);
    };

    const addParagraph = (text) => {
      doc.fontSize(10).font('Helvetica').text(text, { align: 'justify', lineGap: 3 });
      doc.moveDown(0.3);
    };

    const addLabelValue = (label, value) => {
      doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
      doc.font('Helvetica').text(` ${value}`);
    };

    const addDivider = () => {
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke();
      doc.moveDown(0.5);
    };

    const checkNewPage = () => {
      if (doc.y > 720) doc.addPage();
    };

    // ─── Master Agreement Content ─────────────────────────────────────────────
    addTitle('VENDOR SERVICE AGREEMENT');
    addSubtitle('MASTER AGREEMENT');

    addParagraph(`This Vendor Service Agreement ("Agreement") is entered into on ${fmtDate(agreement.start_date)} between:`);
    doc.moveDown(0.3);

    addLabelValue('Service Provider:', companyName);
    addLabelValue('Address:', companyAddress);
    doc.moveDown(0.3);
    addLabelValue('Client:', agreement.client_name || '');
    addLabelValue('Brand:', agreement.client_brand || '');

    checkNewPage();
    addHeading('1. Scope of Services');
    addParagraph(`The Service Provider agrees to provide the following services: ${serviceNames}`);

    checkNewPage();
    addHeading('2. Term');
    addParagraph(`This Agreement shall commence on ${fmtDate(agreement.start_date)} and shall continue until ${fmtDate(agreement.end_date)}, unless terminated earlier in accordance with the terms herein.`);

    checkNewPage();
    addHeading('3. Fees & Payment');
    addLabelValue('Total Fee:', `INR ${replacements['{{total_fee}}']}`);
    addLabelValue('Payment Terms:', replacements['{{payment_terms}}']);
    addLabelValue('Advance Payment:', `INR ${replacements['{{advance_payment}}']}`);
    addLabelValue('AMC (Annual Maintenance Charge):', `INR ${replacements['{{amc_amount}}']}`);

    checkNewPage();
    addHeading('4. Confidentiality');
    addParagraph('Both parties agree to maintain confidentiality of all proprietary information shared during the course of this agreement.');

    checkNewPage();
    addHeading('5. Termination');
    addParagraph('Either party may terminate this Agreement by providing 30 days written notice. In case of breach, the non-breaching party may terminate immediately.');

    addDivider();

    addLabelValue(`For ${companyName}`, '');
    addParagraph('Authorized Signatory: _____________________');
    addParagraph(`Date: ${today}`);
    doc.moveDown(0.5);
    addLabelValue(`For ${agreement.client_name || ''}`, '');
    addParagraph('Authorized Signatory: _____________________');
    addParagraph(`Date: ${today}`);

    // ─── Service-specific pages ───────────────────────────────────────────────
    const SERVICE_KEY_MAP = {
      'Social Media Marketing': 'social_media_marketing',
      'Performance Marketing': 'performance_marketing',
      'SEO': 'seo',
      'Personal Branding': 'personal_branding',
      'Influencer Marketing': 'influencer_marketing',
      'Website Development': 'website_development',
    };

    const SERVICE_DELIVERABLES = {
      'Social Media Marketing': [
        'Social media strategy development',
        'Content creation and scheduling',
        'Community management',
        'Monthly analytics and reporting',
        'Platform management (Instagram, Facebook, LinkedIn, Twitter)',
      ],
      'Performance Marketing': [
        'Google Ads campaign management',
        'Meta (Facebook/Instagram) Ads',
        'Campaign strategy and optimization',
        'A/B testing and conversion tracking',
        'Monthly performance reports with ROI analysis',
      ],
      'SEO': [
        'Technical SEO audit and fixes',
        'On-page optimization',
        'Off-page SEO and link building',
        'Keyword research and strategy',
        'Monthly ranking and traffic reports',
      ],
      'Personal Branding': [
        'Personal brand strategy development',
        'LinkedIn profile optimization and content',
        'Thought leadership content creation',
        'Public speaking and media coaching',
        'Online reputation management',
      ],
      'Influencer Marketing': [
        'Influencer identification and outreach',
        'Campaign planning and execution',
        'Content collaboration management',
        'Performance tracking and reporting',
        'Contract negotiation with influencers',
      ],
      'Website Development': [
        'UI/UX design and prototyping',
        'Frontend and backend development',
        'Responsive design implementation',
        'CMS integration',
        'Testing, deployment, and handover',
      ],
    };

    for (const svc of services) {
      if (!SERVICE_KEY_MAP[svc.name]) continue;

      doc.addPage();
      addTitle(`${svc.name.toUpperCase()} SERVICE AGREEMENT`);

      addParagraph(`This Agreement is entered into on ${fmtDate(agreement.start_date)} between:`);
      doc.moveDown(0.3);
      addLabelValue('Service Provider:', companyName);
      addLabelValue('Client:', `${agreement.client_name || ''} (${agreement.client_brand || ''})`);

      addHeading('1. Scope of Services');
      addParagraph(`The Service Provider shall provide ${svc.name} services including:`);

      const deliverables = SERVICE_DELIVERABLES[svc.name] || [];
      deliverables.forEach(item => {
        doc.fontSize(10).font('Helvetica').text(`  •  ${item}`, { indent: 10 });
      });
      doc.moveDown(0.5);

      addHeading('2. Term');
      addParagraph(`From ${fmtDate(agreement.start_date)} to ${fmtDate(agreement.end_date)}`);

      addHeading('3. Fees');
      addLabelValue('Total Fee:', `INR ${replacements['{{total_fee}}']}`);
      addLabelValue('Payment Terms:', replacements['{{payment_terms}}']);
      addLabelValue('Advance:', `INR ${replacements['{{advance_payment}}']}`);
      addLabelValue('AMC:', `INR ${replacements['{{amc_amount}}']}`);

      if (svc.name === 'Performance Marketing') {
        doc.moveDown(0.3);
        doc.fontSize(9).font('Helvetica-Oblique').text('Note: Ad spend budget is separate from service fees.');
        doc.font('Helvetica');
      }
      if (svc.name === 'Influencer Marketing') {
        doc.moveDown(0.3);
        doc.fontSize(9).font('Helvetica-Oblique').text('Note: Influencer fees/collaborations are billed separately.');
        doc.font('Helvetica');
      }
      if (svc.name === 'Website Development') {
        addHeading('4. Deliverables');
        addParagraph('Complete website with source code, documentation, and 30-day post-launch support.');
      }

      addDivider();
      addLabelValue(`For ${companyName}`, '');
      addParagraph('Signature: _____________________');
      addParagraph(`Date: ${today}`);
      doc.moveDown(0.5);
      addLabelValue(`For ${agreement.client_name || ''}`, '');
      addParagraph('Signature: _____________________');
      addParagraph(`Date: ${today}`);
    }

    // Finalize PDF
    doc.end();
    const pdfBuffer = await pdfReady;

    // Save PDF to uploads folder
    const tempDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const filename = `client_agreement_${agreement.id}_${Date.now()}.pdf`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, pdfBuffer);

    // Return the full URL to access the PDF
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfUrl = `${baseUrl}/uploads/documents/${filename}`;
    return res.json({ url: pdfUrl });

  } catch (err) {
    console.error('Client agreement generate error:', err.message || err);
    console.error('Stack:', err.stack);
    return res.status(500).json({ message: 'Failed to generate PDF', error: err.message });
  }
};
