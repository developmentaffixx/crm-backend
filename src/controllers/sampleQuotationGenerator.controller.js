const db   = require('../config/db');
const path = require('path');
const fs   = require('fs');

/**
 * POST /api/settings/company/generate-sample-quotation
 *
 * Accepts an uploaded PDF, DOCX, or DOC file.
 * Extracts the text content from the document, then renders it
 * as a PDF using the company's quotation letterhead as the background.
 * Returns the PDF inline.
 */
exports.generateSampleQuotation = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { mimetype, originalname, buffer } = req.file;
    const extLower = originalname.toLowerCase();

    // ─── Extract text from uploaded document ─────────────────────────────────
    let extractedText = '';

    const isPdf  = mimetype === 'application/pdf' || extLower.endsWith('.pdf');
    const isDocx = mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                   || extLower.endsWith('.docx');
    const isDoc  = mimetype === 'application/msword' || extLower.endsWith('.doc');

    if (isPdf) {
      try {
        // pdf-parse has a known issue where it tries to load a local test file
        // when the module is first required. Suppress that by setting the
        // PDFJS_DISABLE_WORKER env var and using the low-level import path.
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const data = await pdfParse(buffer);
        extractedText = data.text || '';
      } catch (pdfErr) {
        console.error('PDF parse error:', pdfErr.message);
        return res.status(422).json({
          message: 'Could not extract text from PDF. Make sure the PDF contains selectable text (not scanned images).',
        });
      }
    } else if (isDocx || isDoc) {
      try {
        const mammoth = require('mammoth');
        const result  = await mammoth.extractRawText({ buffer });
        extractedText = result.value || '';
      } catch (docErr) {
        console.error('DOCX/DOC parse error:', docErr.message);
        if (isDoc) {
          return res.status(422).json({
            message: 'Legacy .doc format could not be extracted. Please convert to .docx or PDF and try again.',
          });
        }
        return res.status(422).json({
          message: 'Could not extract text from the document.',
        });
      }
    } else {
      return res.status(400).json({
        message: 'Unsupported file type. Please upload a PDF, DOCX, or DOC file.',
      });
    }

    if (!extractedText.trim()) {
      return res.status(422).json({
        message: 'No text content could be extracted. The document may be image-only or empty.',
      });
    }

    // ─── Fetch company settings for letterhead ───────────────────────────────
    const [companyRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const company = companyRows[0] || {};

    // ─── Download quotation letterhead image ─────────────────────────────────
    let letterheadBuffer = null;
    const letterheadUrl  = company.quotation_letterhead_url;
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
              resp.on('end',  () => resolve(Buffer.concat(chunks)));
              resp.on('error', reject);
            }).on('error', reject);
          });
        } else {
          const p = path.join(__dirname, '../../', letterheadUrl);
          if (fs.existsSync(p)) letterheadBuffer = fs.readFileSync(p);
        }
      } catch (e) {
        console.error('Letterhead load error:', e.message);
        // Non-fatal — continue without letterhead
      }
    }

    // ─── Build PDF using PDFKit ───────────────────────────────────────────────
    const PDFDocument = require('pdfkit');

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
      bufferPages: false,
    });

    // Collect chunks BEFORE writing anything (important — must be set up first)
    const chunks = [];
    doc.on('data',  chunk => chunks.push(chunk));

    const pdfReady = new Promise((resolve, reject) => {
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Register NotoSans fonts
    const fontsDir        = path.join(__dirname, '../../fonts');
    const notoRegularPath = path.join(fontsDir, 'NotoSans-Regular.ttf');
    const notoBoldPath    = path.join(fontsDir, 'NotoSans-Bold.ttf');

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
    const TOP_START     = 110;  // space for letterhead header area
    const BOTTOM_LIMIT  = 760;  // stop before letterhead footer area

    // Add letterhead background image
    const addLetterheadBg = () => {
      if (letterheadBuffer) {
        try {
          doc.image(letterheadBuffer, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
        } catch (_) { /* ignore bad image */ }
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

    // ─── Render extracted text ────────────────────────────────────────────────
    const rawLines = extractedText.split('\n');

    for (const rawLine of rawLines) {
      const line    = rawLine.trimEnd();
      const trimmed = line.trim();

      if (!trimmed) {
        doc.moveDown(0.4);
        continue;
      }

      checkNewPage(14);
      resetX();

      // Heuristic: ALL-CAPS short lines → bold heading
      const isHeading =
        (trimmed === trimmed.toUpperCase() &&
         trimmed.length > 3 &&
         trimmed.length < 80 &&
         !/^\d/.test(trimmed) &&
         !/^[^a-zA-Z]/.test(trimmed)) ||
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
        // Numbered/bullet list items get a slight indent
        const isList = /^(\d+[\.\)]\s|\([a-z]\)\s|[•\-]\s)/.test(trimmed);
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

    // ─── Finalize and send ────────────────────────────────────────────────────
    doc.end();
    const pdfBuffer = await pdfReady;

    const baseName = originalname.replace(/\.[^.]+$/, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);

  } catch (err) {
    console.error('Sample quotation generation error:', err);
    return res.status(500).json({
      message: 'Failed to generate sample quotation PDF',
      error: err.message,
    });
  }
};
