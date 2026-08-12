const db = require('../config/db');
const path = require('path');
const fs = require('fs');

/**
 * GET /api/quotations/:id/pdf
 * Generates a PDF for a quotation using PDFKit with letterhead background
 */
exports.generatePdf = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');

    // Fetch quotation
    const [rows] = await db.query(
      `SELECT q.*, l.name AS lead_name, l.email AS lead_email
       FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id
       WHERE q.id = ? AND q.deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Quotation not found' });
    const quotation = rows[0];

    // Fetch company settings for letterhead
    const [companyRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const company = companyRows[0] || {};

    // Download letterhead image
    let letterheadBuffer = null;
    const letterheadUrl = company.quotation_letterhead_url;
    if (letterheadUrl) {
      try {
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
          const p = path.join(__dirname, '../../', letterheadUrl);
          if (fs.existsSync(p)) letterheadBuffer = fs.readFileSync(p);
        }
      } catch (e) { console.error('Letterhead load error:', e.message); }
    }

    // Parse JSON fields
    const processSections = typeof quotation.process_sections === 'string' ? JSON.parse(quotation.process_sections || '[]') : (quotation.process_sections || []);
    const planIncludes = typeof quotation.plan_includes === 'string' ? JSON.parse(quotation.plan_includes || '[]') : (quotation.plan_includes || []);
    const terms = typeof quotation.terms === 'string' ? JSON.parse(quotation.terms || '[]') : (quotation.terms || []);

    // ─── Setup PDF ────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 50, right: 50 } });

    // Register fonts
    const fontsDir = path.join(__dirname, '../../fonts');
    const notoRegularPath = path.join(fontsDir, 'NotoSans-Regular.ttf');
    const notoBoldPath = path.join(fontsDir, 'NotoSans-Bold.ttf');
    const notoItalicPath = path.join(fontsDir, 'NotoSans-Italic.ttf');

    const hasNotoRegular = fs.existsSync(notoRegularPath);
    const hasNotoBold = fs.existsSync(notoBoldPath);
    const hasNotoItalic = fs.existsSync(notoItalicPath);

    const FONT_REGULAR = hasNotoRegular ? 'NotoSans' : 'Helvetica';
    const FONT_BOLD = hasNotoBold ? 'NotoSans-Bold' : 'Helvetica-Bold';
    const FONT_ITALIC = hasNotoItalic ? 'NotoSans-Italic' : 'Helvetica-Oblique';

    if (hasNotoRegular) doc.registerFont('NotoSans', notoRegularPath);
    if (hasNotoBold) doc.registerFont('NotoSans-Bold', notoBoldPath);
    if (hasNotoItalic) doc.registerFont('NotoSans-Italic', notoItalicPath);

    // Page constants
    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const LEFT_MARGIN = 50;
    const RIGHT_MARGIN = 50;
    const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;
    const TOP_START = 100;       // Where content starts on page 1 (below logo)
    const TOP_START_OTHER = 115; // Where content starts on page 2+ (more clearance)
    const BOTTOM_LIMIT = 770;    // Stop before footer area

    // Letterhead background
    const addLetterheadBg = () => {
      if (letterheadBuffer) {
        try { doc.image(letterheadBuffer, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT }); } catch {}
      }
    };

    // Add letterhead on first page
    addLetterheadBg();
    doc.y = TOP_START;

    // Listen for new pages
    doc.on('pageAdded', () => {
      addLetterheadBg();
      doc.y = TOP_START_OTHER;
    });

    // Check page break
    const checkNewPage = (minSpace = 20) => {
      if (doc.y > (BOTTOM_LIMIT - minSpace)) {
        doc.addPage();
      }
    };

    const resetX = () => { doc.x = LEFT_MARGIN; };

    // ─── Render Content ───────────────────────────────────────────────────────

    // Title (centered)
    doc.fontSize(18).font(FONT_BOLD).text(`${quotation.service_title} - Quotation`, LEFT_MARGIN, doc.y, {
      width: CONTENT_WIDTH, align: 'center'
    });
    doc.moveDown(0.5);

    // Client Details (left-aligned)
    if (quotation.client_name || quotation.brand_name || quotation.client_phone) {
      resetX();
      if (quotation.client_name) {
        doc.fontSize(10).font(FONT_BOLD).text('Client: ', LEFT_MARGIN, doc.y, { continued: true });
        doc.font(FONT_REGULAR).text(quotation.client_name);
      }
      if (quotation.brand_name) {
        resetX();
        doc.fontSize(10).font(FONT_BOLD).text('Brand: ', LEFT_MARGIN, doc.y, { continued: true });
        doc.font(FONT_REGULAR).text(quotation.brand_name);
      }
      if (quotation.client_phone) {
        resetX();
        doc.fontSize(10).font(FONT_BOLD).text('Phone: ', LEFT_MARGIN, doc.y, { continued: true });
        doc.font(FONT_REGULAR).text(quotation.client_phone);
      }
      if (quotation.valid_until) {
        resetX();
        // Format date as dd-mm-yyyy
        const vDate = new Date(quotation.valid_until);
        const formattedDate = `${String(vDate.getDate()).padStart(2, '0')}-${String(vDate.getMonth() + 1).padStart(2, '0')}-${vDate.getFullYear()}`;
        doc.fontSize(10).font(FONT_BOLD).text('Valid Until: ', LEFT_MARGIN, doc.y, { continued: true });
        doc.font(FONT_REGULAR).text(formattedDate);
      }
      doc.moveDown(0.7);
    }

    // Tagline
    if (quotation.tagline) {
      resetX();
      doc.fontSize(11).font(FONT_BOLD).text(quotation.tagline, LEFT_MARGIN, doc.y, {
        width: CONTENT_WIDTH
      });
      doc.moveDown(0.5);
    }

    // Description
    if (quotation.description) {
      resetX();
      const descLines = quotation.description.split('\n');
      for (const line of descLines) {
        if (!line.trim()) { doc.moveDown(0.5); continue; }
        checkNewPage(20);
        resetX();
        // Detect heading lines (short questions or section titles)
        const isHeading = (line.trim().endsWith('?') && line.trim().length < 80) ||
          line.trim() === 'Why Does Your Business Need SEO?' ||
          line.trim() === 'Why Does SEO Take Time?' ||
          line.trim().startsWith('What is SEO');
        if (isHeading) {
          doc.moveDown(0.4);
          doc.fontSize(10).font(FONT_BOLD).text(line.trim(), LEFT_MARGIN, doc.y, {
            width: CONTENT_WIDTH, align: 'left', lineGap: 3
          });
          doc.moveDown(0.3);
        } else {
          doc.fontSize(9).font(FONT_REGULAR).text(line.trim(), LEFT_MARGIN, doc.y, {
            width: CONTENT_WIDTH, align: 'left', lineGap: 3
          });
          doc.moveDown(0.2);
        }
      }
      doc.moveDown(0.7);
    }

    // Horizontal rule
    checkNewPage(30);
    doc.moveDown(0.5);

    // ─── Our Process / Roadmap ────────────────────────────────────────────────
    if (processSections.length > 0) {
      checkNewPage(40);
      resetX();
      const processTitle = quotation.service_type === 'seo' ? 'The Affixx SEO Growth Roadmap' : 'Our Process';
      doc.fontSize(14).font(FONT_BOLD).text(processTitle, LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.5);

      for (const sec of processSections) {
        checkNewPage(50);
        resetX();

        // Section title
        doc.fontSize(11).font(FONT_BOLD).text(sec.title, LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.3);

        // Subtitle
        if (sec.subtitle) {
          resetX();
          doc.fontSize(9).font(FONT_BOLD).text(sec.subtitle, LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
          doc.moveDown(0.4);
        }

        // Items
        for (const item of (sec.items || [])) {
          checkNewPage(14);
          resetX();
          doc.fontSize(9).font(FONT_REGULAR).text(`• ${item}`, LEFT_MARGIN + 16, doc.y, {
            width: CONTENT_WIDTH - 16, lineGap: 3
          });
          doc.moveDown(0.1);
        }

        // Goal (for SEO)
        if (sec.goal) {
          doc.moveDown(0.3);
          checkNewPage(20);
          resetX();
          doc.fontSize(9).font(FONT_BOLD).text('Goal', LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
          doc.moveDown(0.1);
          resetX();
          doc.fontSize(9).font(FONT_REGULAR).text(sec.goal, LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1 });
        }

        // Milestones (for SEO)
        if (sec.milestones && sec.milestones.length > 0) {
          doc.moveDown(0.3);
          checkNewPage(20);
          resetX();
          doc.fontSize(9).font(FONT_BOLD).text('Expected Milestone', LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
          doc.moveDown(0.1);
          for (const m of sec.milestones) {
            checkNewPage(12);
            resetX();
            doc.fontSize(9).font(FONT_REGULAR).text(`• ${m}`, LEFT_MARGIN + 16, doc.y, {
              width: CONTENT_WIDTH - 16, lineGap: 1
            });
          }
        }

        doc.moveDown(0.6);
      }

      // Force page break: Plan & Terms go to page 2
      doc.addPage();
    }

    // ─── Plan Includes ────────────────────────────────────────────────────────
    if (planIncludes.length > 0) {
      checkNewPage(40);
      resetX();
      doc.fontSize(14).font(FONT_BOLD).text(quotation.plan_title || 'Plan Includes', LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.6);

      for (const item of planIncludes) {
        checkNewPage(16);
        resetX();

        if (item.label && !item.value) {
          // Sub-header (bold, no bullet)
          doc.moveDown(0.4);
          doc.fontSize(10).font(FONT_BOLD).text(item.label, LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
          doc.moveDown(0.3);
        } else if (item.label && item.value) {
          // Label: value
          doc.fontSize(9).font(FONT_BOLD).text(`• ${item.label}: `, LEFT_MARGIN + 16, doc.y, {
            width: CONTENT_WIDTH - 16, continued: true
          });
          doc.font(FONT_REGULAR).text(item.value);
          doc.moveDown(0.15);
        } else if (item.value) {
          // Plain bullet
          doc.fontSize(9).font(FONT_REGULAR).text(`• ${item.value}`, LEFT_MARGIN + 16, doc.y, {
            width: CONTENT_WIDTH - 16, lineGap: 3
          });
          doc.moveDown(0.15);
        }
      }
      doc.moveDown(0.7);
    }

    // ─── Investment ───────────────────────────────────────────────────────────
    checkNewPage(30);
    resetX();
    doc.moveDown(0.3);
    const amount = quotation.investment_amount ? `\u20B9 ${Number(quotation.investment_amount).toLocaleString('en-IN')}` : '\u20B9 ________';
    const label = quotation.investment_label || '/ Month';

    // If label has newlines (SEO has extra text), split it
    const labelParts = label.split('\n').filter(l => l.trim());
    doc.fontSize(11).font(FONT_BOLD).text('Investment', LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.3);
    resetX();
    doc.fontSize(10).font(FONT_REGULAR).text(`${amount} ${labelParts[0] || '/ Month'}`, LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });

    // Additional investment info lines (e.g., SEO recommended commitment)
    if (labelParts.length > 1) {
      for (let i = 1; i < labelParts.length; i++) {
        doc.moveDown(0.4);
        checkNewPage(14);
        resetX();
        doc.fontSize(9).font(FONT_REGULAR).text(labelParts[i], LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 3 });
      }
    }
    doc.moveDown(0.7);

    // ─── Terms & Conditions ───────────────────────────────────────────────────
    if (terms.length > 0) {
      checkNewPage(40);
      resetX();
      doc.fontSize(12).font(FONT_BOLD).text('Terms & Conditions', LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.5);

      terms.forEach((term, idx) => {
        checkNewPage(18);
        resetX();
        doc.fontSize(9).font(FONT_REGULAR).text(`${idx + 1}. ${term}`, LEFT_MARGIN + 10, doc.y, {
          width: CONTENT_WIDTH - 10, lineGap: 3
        });
        doc.moveDown(0.3);
      });
      doc.moveDown(0.7);
    }

    // ─── Bank Account Details ─────────────────────────────────────────────────
    // Use quotation-level bank details, fallback to company settings
    const bankName = quotation.bank_name || company.bank_name || '';
    const bankAccount = quotation.account_number || company.bank_account_no || '';
    const bankIfsc = quotation.ifsc_code || company.bank_ifsc || '';
    const bankBranch = quotation.branch || company.bank_branch || '';
    const bankUpi = quotation.upi_id || company.upi_id || '';

    if (bankName || bankAccount) {
      checkNewPage(60);
      resetX();
      doc.fontSize(12).font(FONT_BOLD).text('Bank Account Details', LEFT_MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.5);

      const bankDetails = [
        bankName && ['Bank', bankName],
        bankAccount && ['Account No', bankAccount],
        bankIfsc && ['IFSC', bankIfsc],
        bankBranch && ['Branch', bankBranch],
        bankUpi && ['UPI', bankUpi],
      ].filter(Boolean);

      for (const [lbl, val] of bankDetails) {
        checkNewPage(14);
        resetX();
        doc.fontSize(9).font(FONT_BOLD).text(`${lbl}: `, LEFT_MARGIN, doc.y, { continued: true });
        doc.font(FONT_REGULAR).text(val);
        doc.moveDown(0.3);
      }
    }

    // ─── Finalize PDF ─────────────────────────────────────────────────────────
    doc.end();

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${quotation.quotation_number}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });

  } catch (err) {
    console.error('Quotation PDF generate error:', err);
    return res.status(500).json({ message: 'Failed to generate PDF' });
  }
};
