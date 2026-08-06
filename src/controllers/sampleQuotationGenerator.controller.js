const db   = require('../config/db');
const path = require('path');
const fs   = require('fs');

/**
 * POST /api/settings/company/generate-sample-quotation
 *
 * Strategy:
 *   PDF uploads  → use pdf-lib to embed the quotation letterhead image as a
 *                  full-page background BEHIND every page of the original PDF.
 *                  All original text, tables, images and formatting are preserved
 *                  100% — only the background changes.
 *
 *   DOCX/DOC     → extract text with mammoth, render with PDFKit + letterhead.
 *
 * Returns the resulting PDF inline.
 */
exports.generateSampleQuotation = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { mimetype, originalname, buffer } = req.file;
    const extLower = originalname.toLowerCase();

    const isPdf  = mimetype === 'application/pdf' || extLower.endsWith('.pdf');
    const isDocx = mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                   || extLower.endsWith('.docx');
    const isDoc  = mimetype === 'application/msword' || extLower.endsWith('.doc');

    if (!isPdf && !isDocx && !isDoc) {
      return res.status(400).json({
        message: 'Unsupported file type. Please upload a PDF, DOCX, or DOC file.',
      });
    }

    // ─── Fetch company settings ───────────────────────────────────────────────
    const [companyRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const company       = companyRows[0] || {};
    const letterheadUrl = company.quotation_letterhead_url || null;

    // ─── Download letterhead image ────────────────────────────────────────────
    let letterheadBytes = null;
    let letterheadMime  = 'image/png';

    if (letterheadUrl) {
      try {
        if (letterheadUrl.startsWith('http')) {
          const https = require('https');
          const http  = require('http');
          letterheadBytes = await new Promise((resolve, reject) => {
            const client = letterheadUrl.startsWith('https') ? https : http;
            client.get(letterheadUrl, (resp) => {
              const chunks = [];
              resp.on('data',  chunk => chunks.push(chunk));
              resp.on('end',   () => resolve(Buffer.concat(chunks)));
              resp.on('error', reject);
            }).on('error', reject);
          });
          letterheadMime = letterheadUrl.match(/\.jpe?g($|\?)/i) ? 'image/jpeg' : 'image/png';
        } else {
          const p = path.join(__dirname, '../../', letterheadUrl);
          if (fs.existsSync(p)) {
            letterheadBytes = fs.readFileSync(p);
            letterheadMime  = p.match(/\.jpe?g$/i) ? 'image/jpeg' : 'image/png';
          }
        }
      } catch (e) {
        console.error('Letterhead load error (non-fatal):', e.message);
        letterheadBytes = null;
      }
    }

    const baseName = originalname.replace(/\.[^.]+$/, '');

    // ═══════════════════════════════════════════════════════════════════════════
    // PDF PATH — embed letterhead behind every page using pdf-lib
    // ═══════════════════════════════════════════════════════════════════════════
    if (isPdf) {
      const { PDFDocument, PDFName } = require('pdf-lib');

      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      } catch (loadErr) {
        return res.status(422).json({
          message: 'Could not parse the uploaded PDF. It may be corrupted or password-protected.',
        });
      }

      // If no letterhead, return original PDF unchanged
      if (!letterheadBytes) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
      }

      // Embed letterhead image (try PNG, fall back to JPEG)
      let letterheadImage = null;
      try {
        letterheadImage = letterheadMime === 'image/jpeg'
          ? await srcDoc.embedJpg(letterheadBytes)
          : await srcDoc.embedPng(letterheadBytes);
      } catch (_) {
        // Try the other format
        try {
          letterheadImage = letterheadMime === 'image/jpeg'
            ? await srcDoc.embedPng(letterheadBytes)
            : await srcDoc.embedJpg(letterheadBytes);
        } catch (imgErr) {
          console.error('Cannot embed letterhead image:', imgErr.message);
          // Proceed without letterhead
          letterheadImage = null;
        }
      }

      if (letterheadImage) {
        for (const page of srcDoc.getPages()) {
          const { width, height } = page.getSize();

          // ── Add image to page XObject resources ──────────────────────────
          let resources = page.node.get(PDFName.of('Resources'));
          if (!resources) {
            resources = srcDoc.context.obj({});
            page.node.set(PDFName.of('Resources'), resources);
          }
          let xObjs = resources.get(PDFName.of('XObject'));
          if (!xObjs) {
            xObjs = srcDoc.context.obj({});
            resources.set(PDFName.of('XObject'), xObjs);
          }
          xObjs.set(PDFName.of('LH_BG'), letterheadImage.ref);

          // ── Build background drawing stream ───────────────────────────────
          // q … Q wraps the image draw so it doesn't affect other graphics state
          // The CTM scales the 1×1 image unit to fill the full page
          const bgOps   = `q\n${width} 0 0 ${height} 0 0 cm\n/LH_BG Do\nQ\n`;
          const bgStream = srcDoc.context.flateStream(bgOps);
          const bgRef    = srcDoc.context.register(bgStream);

          // ── Prepend background stream to page Contents ────────────────────
          // Prepending means the letterhead is drawn first (below existing content)
          const existing = page.node.get(PDFName.of('Contents'));
          let contentsArray;

          if (!existing) {
            contentsArray = srcDoc.context.obj([bgRef]);
          } else if (existing.constructor.name === 'PDFArray') {
            contentsArray = srcDoc.context.obj([bgRef, ...existing.asArray()]);
          } else {
            // Single ref (PDFRef) or stream
            contentsArray = srcDoc.context.obj([bgRef, existing]);
          }

          page.node.set(PDFName.of('Contents'), contentsArray);
        }
      }

      const pdfBytes  = await srcDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DOCX / DOC PATH — extract text + PDFKit render + letterhead
    // ═══════════════════════════════════════════════════════════════════════════
    let extractedText = '';
    try {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ buffer });
      extractedText = result.value || '';
    } catch (docErr) {
      console.error('DOCX/DOC parse error:', docErr.message);
      return res.status(422).json({
        message: isDoc
          ? 'Legacy .doc could not be extracted. Please convert to .docx or PDF.'
          : 'Could not extract text from the document.',
      });
    }

    if (!extractedText.trim()) {
      return res.status(422).json({ message: 'No text content found in the document.' });
    }

    const PDFDocument2 = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 50, right: 50 } });

    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    const pdfReady = new Promise((resolve, reject) => {
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const fontsDir = path.join(__dirname, '../../fonts');
    const rPath    = path.join(fontsDir, 'NotoSans-Regular.ttf');
    const bPath    = path.join(fontsDir, 'NotoSans-Bold.ttf');
    const FREG     = fs.existsSync(rPath) ? 'NotoSans'      : 'Helvetica';
    const FBOLD    = fs.existsSync(bPath) ? 'NotoSans-Bold' : 'Helvetica-Bold';
    if (fs.existsSync(rPath)) doc.registerFont('NotoSans',      rPath);
    if (fs.existsSync(bPath)) doc.registerFont('NotoSans-Bold', bPath);

    const PW = 595.28, PH = 841.89, LM = 50, CW = PW - LM - 50;
    const TOP = 110, BOT = 760;

    const addBg = () => {
      if (letterheadBytes) {
        try { doc.image(letterheadBytes, 0, 0, { width: PW, height: PH }); } catch (_) {}
      }
    };
    addBg();
    doc.y = TOP;
    doc.on('pageAdded', () => { addBg(); doc.y = TOP; });

    const chkPage = (h = 16) => { if (doc.y > BOT - h) doc.addPage(); };

    for (const rawLine of extractedText.split('\n')) {
      const t = rawLine.trim();
      if (!t) { doc.moveDown(0.4); continue; }
      chkPage(14);
      doc.x = LM;
      const isH = (t === t.toUpperCase() && t.length > 3 && t.length < 80 && /[A-Z]/.test(t)) ||
                  /^(ARTICLE|SECTION|CLAUSE|SCHEDULE|ANNEXURE)\s/i.test(t);
      if (isH) {
        doc.moveDown(0.3);
        doc.fontSize(11).font(FBOLD).text(t, LM, doc.y, { width: CW, lineGap: 2 });
        doc.moveDown(0.15);
      } else {
        const indent = /^(\d+[\.\)]\s|\([a-z]\)\s|[•\-]\s)/.test(t) ? 10 : 0;
        doc.fontSize(9.5).font(FREG).text(t, LM + indent, doc.y, { width: CW - indent, align: 'justify', lineGap: 2 });
      }
    }

    doc.end();
    const pdfBuffer = await pdfReady;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);

  } catch (err) {
    console.error('Sample quotation generation error:', err);
    return res.status(500).json({ message: 'Failed to generate sample quotation PDF', error: err.message });
  }
};
