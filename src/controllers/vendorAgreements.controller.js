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
      services, client_contact, client_address, platforms,
      monthly_creatives, payment_milestones, onboarding_start, onboarding_end
    } = req.body;

    if (!client_id || !start_date || !end_date) {
      return res.status(400).json({ message: 'Client, start date, and end date are required' });
    }

    // Generate agreement_id
    const agreement_id = await generateAgreementId();

    const [result] = await db.query(
      `INSERT INTO vendor_agreements
        (agreement_id, client_id, client_contact, client_address, template_key, start_date, end_date,
         onboarding_start, onboarding_end, total_fee, payment_terms, advance_payment,
         payment_milestones, amc_amount, services, platforms, monthly_creatives, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agreement_id,
        client_id,
        client_contact || null,
        client_address || null,
        template_key || 'master',
        start_date,
        end_date,
        onboarding_start || null,
        onboarding_end || null,
        total_fee || 0,
        payment_terms || null,
        advance_payment || 0,
        payment_milestones ? JSON.stringify(payment_milestones) : null,
        amc_amount || 0,
        JSON.stringify(services || []),
        platforms || null,
        monthly_creatives || null,
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
      services, client_contact, client_address, platforms,
      monthly_creatives, payment_milestones, onboarding_start, onboarding_end
    } = req.body;

    const [result] = await db.query(
      `UPDATE vendor_agreements SET
        client_id = ?, client_contact = ?, client_address = ?, template_key = ?,
        start_date = ?, end_date = ?, onboarding_start = ?, onboarding_end = ?,
        total_fee = ?, payment_terms = ?, advance_payment = ?,
        payment_milestones = ?, amc_amount = ?,
        services = ?, platforms = ?, monthly_creatives = ?
       WHERE id = ? AND deleted = 0`,
      [
        client_id,
        client_contact || null,
        client_address || null,
        template_key || 'master',
        start_date,
        end_date,
        onboarding_start || null,
        onboarding_end || null,
        total_fee || 0,
        payment_terms || null,
        advance_payment || 0,
        payment_milestones ? JSON.stringify(payment_milestones) : null,
        amc_amount || 0,
        JSON.stringify(services || []),
        platforms || null,
        monthly_creatives || null,
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
              l.business_name AS client_brand,
              l.phone AS lead_phone,
              l.address AS lead_address,
              l.city AS lead_city,
              l.state AS lead_state
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
    const companyContact = company.phone || company.contact_number || '';
    const companySignatory = company.signatory_name || 'Authorized Signatory';
    const companySignatoryTitle = company.signatory_title || 'Founder & CEO';

    // Format dates
    const fmtDate = (d) => {
      if (!d) return '';
      const date = new Date(d);
      return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    };

    // Format date as "DD Month YYYY"
    const fmtDateLong = (d) => {
      if (!d) return '';
      const date = new Date(d);
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return `${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
    };

    const today = fmtDate(new Date());
    const todayLong = fmtDateLong(new Date());

    // Calculate contract duration
    const calcDuration = (start, end) => {
      if (!start || !end) return '';
      const s = new Date(start);
      const e = new Date(end);
      const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      if (months === 1) return 'One (1) Month';
      if (months === 2) return 'Two (2) Months';
      if (months === 3) return 'Three (3) Months';
      if (months === 6) return 'Six (6) Months';
      if (months === 12) return 'Twelve (12) Months';
      return `${months} Months`;
    };

    // Number to words (Indian format)
    const numberToWords = (num) => {
      if (!num || num === 0) return 'Zero Only';
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const n = Math.floor(Number(num));
      if (n < 20) return ones[n] + ' Only';
      if (n < 100) return (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')) + ' Only';
      if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numberToWords(n % 100).replace(' Only', '') : '') + ' Only';
      if (n < 100000) return numberToWords(Math.floor(n / 1000)).replace(' Only', '') + ' Thousand' + (n % 1000 ? ' ' + numberToWords(n % 1000).replace(' Only', '') : '') + ' Only';
      if (n < 10000000) return numberToWords(Math.floor(n / 100000)).replace(' Only', '') + ' Lakh' + (n % 100000 ? ' ' + numberToWords(n % 100000).replace(' Only', '') : '') + ' Only';
      return numberToWords(Math.floor(n / 10000000)).replace(' Only', '') + ' Crore' + (n % 10000000 ? ' ' + numberToWords(n % 10000000).replace(' Only', '') : '') + ' Only';
    };

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

    // Parse payment milestones
    let paymentMilestones = [];
    if (agreement.payment_milestones) {
      try {
        paymentMilestones = typeof agreement.payment_milestones === 'string'
          ? JSON.parse(agreement.payment_milestones)
          : agreement.payment_milestones;
      } catch (e) {
        paymentMilestones = [];
      }
    }

    // Build payment milestones HTML table
    let paymentMilestonesTable = '';
    if (paymentMilestones.length > 0) {
      paymentMilestonesTable = '<table style="width:100%;border-collapse:collapse;">';
      paymentMilestonesTable += '<tr><th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;">Payment Milestone</th><th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;">Amount</th><th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;">Due Date</th></tr>';
      paymentMilestones.forEach(m => {
        paymentMilestonesTable += `<tr><td style="border:1px solid #ccc;padding:8px;">${m.milestone || ''}</td><td style="border:1px solid #ccc;padding:8px;">₹${Number(m.amount || 0).toLocaleString('en-IN')}</td><td style="border:1px solid #ccc;padding:8px;">${m.due_date ? fmtDateLong(m.due_date) : ''}</td></tr>`;
      });
      paymentMilestonesTable += '</table>';
    }

    // Client address: use agreement-level or fall back to lead data
    const clientAddress = agreement.client_address || [agreement.lead_address, agreement.lead_city, agreement.lead_state].filter(Boolean).join(', ');
    const clientContact = agreement.client_contact || agreement.lead_phone || '';

    // Build replacements
    const replacements = {
      '{{client_name}}': agreement.client_name || '',
      '{{client_brand}}': agreement.client_brand || '',
      '{{client_address}}': clientAddress,
      '{{client_contact}}': clientContact,
      '{{company_name}}': companyName,
      '{{company_address}}': companyAddress,
      '{{company_contact}}': companyContact,
      '{{company_signatory}}': companySignatory,
      '{{company_signatory_title}}': companySignatoryTitle,
      '{{services}}': serviceNames,
      '{{platforms}}': agreement.platforms || '',
      '{{monthly_creatives}}': agreement.monthly_creatives || '',
      '{{start_date}}': fmtDateLong(agreement.start_date),
      '{{end_date}}': fmtDateLong(agreement.end_date),
      '{{onboarding_start}}': fmtDateLong(agreement.onboarding_start),
      '{{onboarding_end}}': fmtDateLong(agreement.onboarding_end),
      '{{contract_duration}}': calcDuration(agreement.start_date, agreement.end_date),
      '{{total_fee}}': agreement.total_fee ? Number(agreement.total_fee).toLocaleString('en-IN') : '0',
      '{{total_fee_words}}': agreement.total_fee ? 'Rupees ' + numberToWords(agreement.total_fee) : '',
      '{{payment_terms}}': agreement.payment_terms || '',
      '{{advance_payment}}': agreement.advance_payment ? Number(agreement.advance_payment).toLocaleString('en-IN') : '0',
      '{{amc_amount}}': agreement.amc_amount ? Number(agreement.amc_amount).toLocaleString('en-IN') : '0',
      '{{payment_milestones_table}}': paymentMilestonesTable,
      '{{today}}': todayLong,
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

    // ─── Render Master Agreement from DB template ───────────────────────────────
    if (masterTemplates.length && masterTemplates[0].content) {
      const content = applyReplacements(masterTemplates[0].content);
      renderHtmlToPdf(doc, content, checkNewPage);
    } else {
      addTitle('VENDOR SERVICE AGREEMENT');
      addParagraph(`This Agreement is entered into on ${fmtDateLong(agreement.start_date)} between:`);
      addLabelValue('Service Provider:', companyName);
      addLabelValue('Client:', agreement.client_name || '');
      addHeading('1. Scope of Services');
      addParagraph(`Services: ${serviceNames}`);
      addHeading('2. Term');
      addParagraph(`From ${fmtDateLong(agreement.start_date)} to ${fmtDateLong(agreement.end_date)}`);
      addHeading('3. Fees');
      addLabelValue('Total Fee:', `INR ${replacements['{{total_fee}}']}`);
      addDivider();
      addParagraph('Signature: _____________________');
    }

    // ─── Service-specific pages (from DB templates) ───────────────────────────
    const SERVICE_KEY_MAP = {
      'Social Media Marketing': 'social_media_marketing',
      'Performance Marketing': 'performance_marketing',
      'SEO': 'seo',
      'Personal Branding': 'personal_branding',
      'Influencer Marketing': 'influencer_marketing',
      'Website Development': 'website_development',
    };

    for (const svc of services) {
      const svcKey = SERVICE_KEY_MAP[svc.name];
      if (!svcKey) continue;

      // Fetch service template from DB
      let svcTemplates = [];
      try {
        [svcTemplates] = await db.query(
          'SELECT * FROM vendor_agreement_templates WHERE template_key = ?',
          [svcKey]
        );
      } catch (e) {
        console.error(`Failed to fetch template for ${svcKey}:`, e.message);
      }

      doc.addPage();

      if (svcTemplates.length && svcTemplates[0].content) {
        const content = applyReplacements(svcTemplates[0].content);
        renderHtmlToPdf(doc, content, checkNewPage);
      } else {
        // Fallback: basic service page
        addTitle(`${svc.name.toUpperCase()} SERVICE AGREEMENT`);
        addParagraph(`Services: ${svc.name}`);
        addParagraph(`Term: ${fmtDateLong(agreement.start_date)} to ${fmtDateLong(agreement.end_date)}`);
        addLabelValue('Total Fee:', `INR ${replacements['{{total_fee}}']}`);
        addDivider();
        addParagraph('Signature: _____________________');
      }
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

// ─── HTML to PDF renderer helper ──────────────────────────────────────────────
function renderHtmlToPdf(doc, content, checkNewPage) {
  const stripTags = (html) => html.replace(/<[^>]+>/g, '');

  const sections = content.split(/(?=<h[123])|(?=<p[ >])|(?=<p>)|(?=<table)|(?=<hr)|(?=<ul)|(?=<ol)|(?=<br)/gi);

  for (const section of sections) {
    if (!section.trim()) continue;
    checkNewPage();

    if (section.match(/^<h1/i)) {
      const text = stripTags(section).trim();
      if (text) {
        doc.moveDown(0.5);
        doc.fontSize(16).font('Helvetica-Bold').text(text, { align: 'center' });
        doc.moveDown(0.5);
      }
    } else if (section.match(/^<h2/i)) {
      const text = stripTags(section).trim();
      if (text) {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').text(text);
        doc.moveDown(0.3);
      }
    } else if (section.match(/^<h3/i)) {
      const text = stripTags(section).trim();
      if (text) {
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').text(text);
        doc.moveDown(0.2);
      }
    } else if (section.match(/^<hr/i)) {
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke();
      doc.moveDown(0.5);
    } else if (section.match(/^<br/i)) {
      doc.moveDown(0.3);
    } else if (section.match(/^<table/i)) {
      const rowMatches = section.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const row of rowMatches) {
        checkNewPage();
        const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(c => stripTags(c).trim());
        if (cells.length >= 2) {
          const isHeader = row.includes('<th');
          doc.fontSize(9).font(isHeader ? 'Helvetica-Bold' : 'Helvetica');
          const colWidth = 495 / cells.length;
          const startX = 50;
          const startY = doc.y;
          cells.forEach((cell, i) => {
            doc.text(cell, startX + (i * colWidth), startY, { width: colWidth - 5, align: 'left' });
          });
          doc.y = startY + 18;
        }
      }
      doc.moveDown(0.5);
    } else if (section.match(/^<[uo]l/i)) {
      const items = (section.match(/<li[\s\S]*?<\/li>/gi) || []).map(li => stripTags(li).trim());
      items.forEach(item => {
        checkNewPage();
        doc.fontSize(10).font('Helvetica').text(`  •  ${item}`, { indent: 10 });
      });
      doc.moveDown(0.3);
    } else if (section.match(/^<p/i)) {
      const text = stripTags(section).trim();
      if (text) {
        doc.fontSize(10).font('Helvetica').text(text, { align: 'justify', lineGap: 3 });
        doc.moveDown(0.3);
      }
    } else {
      const text = stripTags(section).trim();
      if (text) {
        doc.fontSize(10).font('Helvetica').text(text, { lineGap: 3 });
        doc.moveDown(0.2);
      }
    }
  }
}
