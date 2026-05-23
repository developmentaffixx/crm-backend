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
    const puppeteer = require('puppeteer');
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

    // Convert letterhead to base64 data URI
    const fileToDataUri = (filePath) => {
      try {
        const absPath = path.join(__dirname, '../../', filePath);
        if (!fs.existsSync(absPath)) return '';
        const buffer = fs.readFileSync(absPath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
        const mime = mimeMap[ext] || 'image/png';
        return `data:${mime};base64,${buffer.toString('base64')}`;
      } catch { return ''; }
    };

    const letterheadUrl = company.letterhead_url ? fileToDataUri(company.letterhead_url) : '';

    // Format dates
    const fmtDate = (d) => {
      if (!d) return '';
      const date = new Date(d);
      return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    };

    const today = fmtDate(new Date());

    // Parse services (supports [{name, fee}] and ["name"] formats)
    let services = [];
    if (agreement.services) {
      const parsed = JSON.parse(agreement.services);
      services = parsed.map(s => typeof s === 'string' ? { name: s, fee: '' } : s);
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
      '{{total_fee}}': Number(agreement.total_fee).toLocaleString('en-IN'),
      '{{payment_terms}}': agreement.payment_terms || '',
      '{{advance_payment}}': Number(agreement.advance_payment).toLocaleString('en-IN'),
      '{{amc_amount}}': Number(agreement.amc_amount).toLocaleString('en-IN'),
      '{{today}}': today,
    };

    const applyReplacements = (html) => {
      for (const [key, value] of Object.entries(replacements)) {
        html = html.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
      }
      return html;
    };

    // 1. Fetch and render the master template
    const [masterTemplates] = await db.query(
      'SELECT * FROM vendor_agreement_templates WHERE template_key = ?',
      ['master']
    );
    let combinedHtml = '';
    if (masterTemplates.length) {
      combinedHtml += applyReplacements(masterTemplates[0].content);
    }

    // 2. Fetch and render each selected service template
    const SERVICE_KEY_MAP = {
      'Social Media Marketing': 'social_media_marketing',
      'Performance Marketing': 'performance_marketing',
      'SEO': 'seo',
      'Personal Branding': 'personal_branding',
      'Influencer Marketing': 'influencer_marketing',
      'Website Development': 'website_development',
    };

    for (const svc of services) {
      const tplKey = SERVICE_KEY_MAP[svc.name];
      if (!tplKey) continue;

      const [svcTemplates] = await db.query(
        'SELECT * FROM vendor_agreement_templates WHERE template_key = ?',
        [tplKey]
      );
      if (svcTemplates.length) {
        combinedHtml += '<div style="page-break-before: always;"></div>';
        combinedHtml += '<div class="page-section">';
        let svcHtml = applyReplacements(svcTemplates[0].content);
        if (svc.fee) {
          svcHtml = svcHtml.replace(/{{service_fee}}/g, Number(svc.fee).toLocaleString('en-IN'));
        }
        combinedHtml += svcHtml;
        combinedHtml += '</div>';
      }
    }

    // Build full HTML with letterhead background
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { margin: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; }
  .letterhead-bg {
    position: fixed;
    top: 0;
    left: 0;
    width: 210mm;
    height: 297mm;
    z-index: -1;
  }
  .letterhead-bg img { width: 100%; height: 100%; }
  .content-wrapper { padding: 26mm 20mm 22mm 20mm; font-size: 12px; line-height: 1.7; color: #222; }
  .page-section { padding-top: 26mm; }
  h1 { font-size: 18px; font-weight: 700; text-align: center; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
  h2 { font-size: 13px; font-weight: 700; margin: 18px 0 8px; }
  p { margin-bottom: 8px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
  ul, ol { padding-left: 20px; margin-bottom: 10px; }
  li { margin-bottom: 4px; }
</style></head><body>
${letterheadUrl ? `<div class="letterhead-bg"><img src="${letterheadUrl}" /></div>` : ''}
<div class="content-wrapper">
  ${combinedHtml}
</div>
</body></html>`;

    // Generate PDF with Puppeteer
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();

    // Save PDF to uploads folder
    const tempDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const filename = `client_agreement_${agreement.id}_${Date.now()}.pdf`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, pdfBuffer);

    // Return the URL to access the PDF
    const pdfUrl = `/uploads/documents/${filename}`;
    return res.json({ url: pdfUrl });

  } catch (err) {
    console.error('Client agreement generate error:', err);
    return res.status(500).json({ message: 'Failed to generate PDF' });
  }
};
