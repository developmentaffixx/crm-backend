const db = require('../config/db');
const path = require('path');
const fs = require('fs');

/**
 * POST /api/settings/document-templates/generate
 * Generates a PDF using PDFKit (no Chrome/Puppeteer needed), saves to temp folder, returns the download URL
 */
exports.generate = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
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

    // Format today's date as dd-mm-yyyy
    const d = new Date();
    const today = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

    // Replace placeholders in template content
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
      '{{kt_project_handover}}': data?.kt_project_handover || '—',
      '{{kt_credentials_shared}}': data?.kt_credentials_shared || '—',
      '{{kt_pending_tasks}}': data?.kt_pending_tasks || '—',
      '{{kt_client_communication}}': data?.kt_client_communication || '—',
      // Exit NOC — Asset Return
      '{{asset_laptop_status}}': data?.asset_laptop_status || '—',
      '{{asset_laptop_condition}}': data?.asset_laptop_condition || '—',
      '{{asset_phone_status}}': data?.asset_phone_status || '—',
      '{{asset_phone_condition}}': data?.asset_phone_condition || '—',
      '{{asset_idcard_status}}': data?.asset_idcard_status || '—',
      '{{asset_idcard_condition}}': data?.asset_idcard_condition || '—',
      '{{asset_charger_status}}': data?.asset_charger_status || '—',
      '{{asset_charger_condition}}': data?.asset_charger_condition || '—',
      // Exit NOC — Department Clearance
      '{{clear_reporting_manager}}': data?.clear_reporting_manager || '—',
      '{{clear_hr}}': data?.clear_hr || '—',
      '{{clear_accounts}}': data?.clear_accounts || '—',
      '{{clear_it}}': data?.clear_it || '—',
    };

    Object.entries(replacements).forEach(([key, val]) => {
      content = content.replaceAll(key, val);
    });

    // ─── Download letterhead image (from Cloudinary URL or local path) ─────────
    let letterheadBuffer = null;
    if (company.letterhead_url) {
      try {
        const letterheadUrl = company.letterhead_url;
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

    // ─── Build PDF with PDFKit ────────────────────────────────────────────────
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 50, right: 50 } });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    const pdfReady = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Function to add letterhead as full-page background
    const addLetterheadBg = () => {
      if (letterheadBuffer) {
        try {
          doc.image(letterheadBuffer, 0, 0, { width: 595.28, height: 841.89 });
        } catch {}
      }
    };

    // Add letterhead on first page
    addLetterheadBg();
    doc.y = 120;

    // Listen for new pages to add letterhead background
    doc.on('pageAdded', () => {
      addLetterheadBg();
      doc.y = 120;
    });

    // ─── Parse HTML content and render to PDF ─────────────────────────────────
    // Strip HTML tags and render as structured text
    const stripTags = (html) => html.replace(/<[^>]+>/g, '');
    
    // Simple HTML-to-PDF renderer
    const lines = content.split(/(<h1[^>]*>.*?<\/h1>|<h2[^>]*>.*?<\/h2>|<p[^>]*>.*?<\/p>|<li[^>]*>.*?<\/li>|<hr\s*\/?>|<br\s*\/?>|<table[\s\S]*?<\/table>|<strong[^>]*>.*?<\/strong>)/gi);
    
    // Process content block by block
    const blocks = content.split(/<\/?(h1|h2|p|li|hr|br|table|tr|td|th|ul|ol|div|strong|em|span)[^>]*>/gi);
    
    // Better approach: split into meaningful sections
    const sections = content.split(/(?=<h[12])|(?=<p)|(?=<table)|(?=<hr)|(?=<ul)|(?=<ol)/gi);

    for (const section of sections) {
      if (!section.trim()) continue;

      const checkNewPage = () => { if (doc.y > 720) doc.addPage(); };
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
      } else if (section.match(/^<hr/i)) {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke();
        doc.moveDown(0.5);
      } else if (section.match(/^<table/i)) {
        // Parse table rows
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
        // Plain text fallback
        const text = stripTags(section).trim();
        if (text) {
          doc.fontSize(10).font('Helvetica').text(text, { lineGap: 3 });
          doc.moveDown(0.2);
        }
      }
    }

    // Finalize PDF
    doc.end();
    const pdfBuffer = await pdfReady;

    // Save PDF to uploads folder
    const tempDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const filename = `${template_key}_${Date.now()}.pdf`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, pdfBuffer);

    // Return the full URL to access the PDF
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfUrl = `${baseUrl}/uploads/documents/${filename}`;
    return res.json({ url: pdfUrl });

  } catch (err) {
    console.error('PDF generation error:', err.message || err);
    console.error('Stack:', err.stack);
    return res.status(500).json({ message: 'Failed to generate PDF', error: err.message });
  }
};
