const db     = require('../config/db');
const path   = require('path');
const fs     = require('fs');

/**
 * POST /api/settings/company/generate-sample-quotation
 *
 * Accepts an uploaded PDF, DOCX, or DOC file.
 * Extracts the text content from the document, then renders it
 * as a PDF using the company's quotation letterhead as the background.
 * Returns the PDF as an inline download.
 */
exports.generateSampleQuotation = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { mimetype, originalname, buffer } = req.file;

    // ─── Extract text from uploaded document ─────────────────────────────────
    let extractedText = '';

    if (mimetype === 'application/pdf') {
      // PDF extraction using pdf-parse
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      extractedText = data.text || '';
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      originalname.toLowerCase().endsWith('.docx')
    ) {
      // DOCX extraction using mammoth
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value || '';
    } else if (
      mimetype === 'application/msword' ||
      originalname.toLowerCase().endsWith('.doc')
    ) {
      // .doc (legacy Word) — mammoth handles basic .doc files too
      const mammoth = require('mammoth');
      try {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value || '';
      } catch {
        return res.status(422).json({
          message: 'Legacy .doc format extraction failed. Please convert to .docx or PDF and try again.',
        });
      }
    } else {
      return res.status(400).json({
        message: 'Unsupported file type. Please upload a PDF, DOCX, or DOC file.',
      });
    }

    if (!extractedText.trim()) {
      return res.status(422).json({
        message: 'No text content could be extracted from the uploaded document.',
      });
    }

    // ─── Fetch company settings for letterhead ───────────────────────────────
    const [companyRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const company = companyRows[0] || {};

    // ─── Download quotation letterhead image ─────────────────────────────────
    let letterheadBuffer = null;
    const letterheadUrl = company.quotation_letterhead_url;
    if (letterheadUrl) {
      try {
        if (letterheadUrl.startsWith('http')) {
          const https = require('https');
          const http  = require('http');
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
      } catch (e) {
        console.error('Letterhead load error:', e.message);
      }
    }

    // ─── Build PDF using PDFKit ───────────────────────────────────────────────
    const PDFDocument = require('pdfkit');

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
    });

    // Register NotoSans fonts (Unicode-safe, supports ₹ etc.)
    const fontsDir = path.join(__dirname, '../../fonts');
    const notoRegularPath   = path.join(fontsDir, 'NotoSans-Regular.ttf');
    const notoBoldPath      = path.join(fontsDir, 'NotoSans-Bold.ttf');

    const hasRegular = fs.existsSync(notoRegularPath);
    const hasBold    = fs.existsSync(notoBoldPath);

    const FONT_REGULAR = hasRegular ? 'NotoSans'      : 'Helvetica';
    const FONT_BOLD    = hasBold    ? 'NotoSans-Bold' : 'Helvetica-Bold';

    if (hasRegular) doc.registerFont('NotoSans',      notoRegularPath);
    if (hasBold)    doc.registerFont('NotoSans-Bold', notoBoldPath);

    // Page geometry
    const PAGE_WIDTH    = 595.28;
    const PAGE_HEIGHT   = 841.89;
    const LEFT_MARGIN   = 50;
    const RIGHT_MARGIN  = 50;
    const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;
    const TOP_START     = 110;   // leave room for letterhead header
    const BOTTOM_LIMIT  = 760;   // stop before letterhead footer

    // Draw letterhead background on every page
    const addLetterheadBg = () => {
      if (letterheadBuffer) {
        try {
          doc.image(letterheadBuffer, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
        } catch (_) { /* ignore */ }
      }
    };

    addLetterheadBg();
    doc.y = TOP_START;

    doc.on('pageAdded', () => {
      addLetterheadBg();
      doc.y = TOP_START;
    });

    const checkNewPage = (minSpace = 16) => {
      if (doc.y > BOTTOM_LIMIT - minSpace) doc.addPage();
    };

    const resetX = () => { doc.x = LEFT_MARGIN; };

    // ─── Render extracted text lines ─────────────────────────────────────────
    // Split into lines, preserve paragraph structure
    const rawLines = extractedText.split('\n');

    for (const rawLine of rawLines) {
      const line = rawLine.trimEnd(); // keep leading spaces for indentation detection

      if (!line.trim()) {
        // Blank line → paragraph gap
        doc.moveDown(0.4);
        continue;
      }

      checkNewPage(14);
      resetX();

      // Simple heuristic: short ALL-CAPS or title-like lines → render as bold heading
      const trimmed = line.trim();
      const isHeading =
        (trimmed === trimmed.toUpperCase() && trimmed.length < 80 && trimmed.length > 3 && !/^\d/.test(trimmed)) ||
        /^(ARTICLE|SECTION|CLAUSE|SCHEDULE|ANNEXURE|EXHIBIT|CHAPTER)\s/i.test(trimmed);

      if (isHeading) {
        doc.moveDown(0.3);
        doc.fontSize(11)
          .font(FONT_BOLD)
          .text(trimmed, LEFT_MARGIN, doc.y, {
            width: CONTENT_WIDTH,
            align: 'left',
            lineGap: 2,
          });
        doc.moveDown(0.15);
      } else {
        // Detect numbered list items (e.g. "1.", "1.1", "(a)", "•")
        const isList = /^(\d+[\.\)]|\([a-z]\)|•|-)\s/.test(trimmed);
        const indent = isList ? 10 : 0;

        doc.fontSize(9.5)
          .font(FONT_REGULAR)
          .text(trimmed, LEFT_MARGIN + indent, doc.y, {
            width: CONTENT_WIDTH - indent,
            align: 'justify',
            lineGap: 2,
          });
      }
    }

    // ─── Finalize and return PDF ──────────────────────────────────────────────
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    const pdfReady = new Promise((resolve, reject) => {
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.end();
    const pdfBuffer = await pdfReady;

    // Return PDF inline
    const baseName = originalname.replace(/\.[^.]+$/, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${baseName}_sample_quotation.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);

  } catch (err) {
    console.error('Sample quotation generation error:', err);
    return res.status(500).json({ message: 'Failed to generate sample quotation PDF', error: err.message });
  }
};
