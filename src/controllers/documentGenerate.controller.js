const puppeteer = require('puppeteer');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');

/**
 * Convert a local file path to a base64 data URI
 */
function fileToDataUri(filePath) {
  try {
    const absPath = path.join(__dirname, '../../', filePath);
    if (!fs.existsSync(absPath)) return '';
    const buffer = fs.readFileSync(absPath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const mime = mimeMap[ext] || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * POST /api/settings/document-templates/generate
 * Generates a PDF, saves to temp folder, returns the download URL
 */
exports.generate = async (req, res) => {
  try {
    const { template_key, data } = req.body;
    if (!template_key) return res.status(400).json({ message: 'template_key is required' });

    // Fetch template
    const [templates] = await db.query(
      'SELECT * FROM document_templates WHERE template_key = ?', [template_key]
    );
    if (!templates.length) return res.status(404).json({ message: 'Template not found' });

    // Fetch company settings
    const [companyRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const company = companyRows[0] || {};

    const companyName = company.company_name || 'AffixxMedia';
    const companyAddress = [company.address_line1, company.address_line2, company.city, company.state].filter(Boolean).join(', ');

    // Convert letterhead to base64 data URI
    const letterheadUrl = company.letterhead_url ? fileToDataUri(company.letterhead_url) : '';

    // Format today's date as dd-mm-yyyy
    const d = new Date();
    const today = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

    // Helper: style NOC answer values with color based on value
    const nocVal = (val) => {
      if (!val || val === '—') return '<span style="color:#999">—</span>';
      const positive = ['Yes', 'Returned', 'Cleared', 'Good'];
      const negative = ['No', 'Pending', 'Damaged'];
      if (positive.includes(val)) return `<strong style="color:#16a34a">${val}</strong>`;
      if (negative.includes(val)) return `<strong style="color:#dc2626">${val}</strong>`;
      return `<strong>${val}</strong>`;
    };

    // Replace placeholders
    let content = templates[0].content;
    const replacements = {
      '{{employee_name}}': data?.employee_name || '',
      '{{designation}}': data?.designation || '',
      '{{department}}': data?.department || '',
      '{{date_of_joining}}': data?.date_of_joining || '',
      '{{salary}}': data?.salary || '',
      '{{employee_address}}': data?.employee_address || '',
      '{{company_name}}': companyName,
      '{{company_address}}': companyAddress,
      '{{from_date}}': data?.from_date || '',
      '{{to_date}}': data?.to_date || '',
      '{{last_working_date}}': data?.last_working_date || '',
      '{{separation_type}}': data?.separation_type || '',
      '{{today}}': today,
      // Exit NOC — Knowledge Transfer
      '{{kt_project_handover}}': nocVal(data?.kt_project_handover),
      '{{kt_credentials_shared}}': nocVal(data?.kt_credentials_shared),
      '{{kt_pending_tasks}}': nocVal(data?.kt_pending_tasks),
      '{{kt_client_communication}}': nocVal(data?.kt_client_communication),
      // Exit NOC — Asset Return
      '{{asset_laptop_status}}': nocVal(data?.asset_laptop_status),
      '{{asset_laptop_condition}}': nocVal(data?.asset_laptop_condition),
      '{{asset_phone_status}}': nocVal(data?.asset_phone_status),
      '{{asset_phone_condition}}': nocVal(data?.asset_phone_condition),
      '{{asset_idcard_status}}': nocVal(data?.asset_idcard_status),
      '{{asset_idcard_condition}}': nocVal(data?.asset_idcard_condition),
      '{{asset_charger_status}}': nocVal(data?.asset_charger_status),
      '{{asset_charger_condition}}': nocVal(data?.asset_charger_condition),
      // Exit NOC — Department Clearance
      '{{clear_reporting_manager}}': nocVal(data?.clear_reporting_manager),
      '{{clear_hr}}': nocVal(data?.clear_hr),
      '{{clear_accounts}}': nocVal(data?.clear_accounts),
      '{{clear_it}}': nocVal(data?.clear_it),
    };

    Object.entries(replacements).forEach(([key, val]) => {
      content = content.replaceAll(key, val);
    });

    // Full HTML page (no logo — letterhead only as background)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
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
  .content-wrapper {
    padding: 42mm 20mm 28mm 20mm;
    font-size: 12px;
    line-height: 1.7;
    color: #222;
    /* Ensure page breaks respect bottom padding */
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
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
  ${content}
</div>
</body></html>`;

    // Generate PDF with Puppeteer
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();

    // Save PDF to temp folder
    const tempDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const filename = `${template_key}_${Date.now()}.pdf`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, pdfBuffer);

    // Return the URL to access the PDF
    const pdfUrl = `/uploads/documents/${filename}`;
    return res.json({ url: pdfUrl });

  } catch (err) {
    console.error('PDF generation error:', err);
    return res.status(500).json({ message: 'Failed to generate PDF' });
  }
};
