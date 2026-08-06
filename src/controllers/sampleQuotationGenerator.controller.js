const db   = require('../config/db');
const path = require('path');
const fs   = require('fs');

/**
 * GET /api/settings/company/sample-quotation-status
 * Health check — reports which packages are available on this server.
 * Useful for diagnosing 500s remotely without SSH access.
 */
exports.statusCheck = (req, res) => {
  const checks = {};

  try { require('pdf-lib');  checks.pdf_lib   = 'ok'; } catch (e) { checks.pdf_lib   = e.message; }
  try { require('mammoth');  checks.mammoth   = 'ok'; } catch (e) { checks.mammoth   = e.message; }
  try { require('pdfkit');   checks.pdfkit    = 'ok'; } catch (e) { checks.pdfkit    = e.message; }
  try { require('pdf-parse/lib/pdf-parse.js'); checks.pdf_parse = 'ok'; } catch (e) { checks.pdf_parse = e.message; }

  const fontsDir    = path.join(__dirname, '../../fonts');
  checks.fonts_dir  = fs.existsSync(fontsDir) ? 'exists' : 'MISSING';
  checks.noto_regular = fs.existsSync(path.join(fontsDir, 'NotoSans-Regular.ttf')) ? 'ok' : 'missing';

  return res.json({ status: 'online', checks });
};

/**
 * POST /api/settings/company/generate-sample-quotation
 *
 * Strategy:
 *   PDF  → pdf-lib: embed quotation letterhead image as full-page background
 *          behind every page. Original formatting/tables/images preserved 100%.
 *   DOCX → mammoth: extract text, render with PDFKit + letterhead background.
 */
exports.generateSampleQuotation = async (req, res) => {
  let _step = 'init';
  try {
    // ── Step 1: validate upload ──────────────────────────────────────────────
    _step = 'validate_file';
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded. Make sure the field name is "document".' });
    }

    const { mimetype, originalname, buffer } = req.file;
    const extLower = originalname.toLowerCase();

    const isPdf  = mimetype === 'application/pdf'      || extLower.endsWith('.pdf');
    const isDocx = mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                   || extLower.endsWith('.docx');
    const isDoc  = mimetype === 'application/msword'   || extLower.endsWith('.doc');

    if (!isPdf && !isDocx && !isDoc) {
      return res.status(400).json({
        message: `Unsupported file type: "${mimetype}". Please upload PDF, DOCX, or DOC.`,
      });
    }

    // ── Step 2: fetch company + letterhead ───────────────────────────────────
    _step = 'fetch_company';
    const [companyRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const company        = companyRows[0] || {};
    const letterheadUrl  = company.quotation_letterhead_url || null;

    // ── Step 3: download letterhead image ────────────────────────────────────
    _step = 'download_letterhead';
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
        console.warn('Letterhead load failed (non-fatal):', e.message);
        letterheadBytes = null;
      }
    }

    const baseName = originalname.replace(/\.[^.]+$/, '');

    // ════════════════════════════════════════════════════════════════════════════
    // PDF PATH — embed letterhead using pdf-lib (preserves all original content)
    // ════════════════════════════════════════════════════════════════════════════
    if (isPdf) {
      _step = 'load_pdf_lib';
      const { PDFDocument, PDFName } = require('pdf-lib');

      _step = 'parse_uploaded_pdf';
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      } catch (loadErr) {
        return res.status(422).json({
          message: 'Could not parse the PDF. It may be corrupted or heavily password-protected.',
          error: loadErr.message,
        });
      }

      // No letterhead → return original unchanged
      if (!letterheadBytes) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
      }

      // ── Step 4: embed letterhead image ─────────────────────────────────────
      _step = 'embed_letterhead_image';
      let letterheadImage = null;

      // Try primary format, then fallback to the other
      const tryEmbed = async (doc, bytes, mime) => {
        try {
          return mime === 'image/jpeg'
            ? await doc.embedJpg(bytes)
            : await doc.embedPng(bytes);
        } catch (_) {
          return mime === 'image/jpeg'
            ? await doc.embedPng(bytes)
            : await doc.embedJpg(bytes);
        }
      };

      try {
        letterheadImage = await tryEmbed(srcDoc, letterheadBytes, letterheadMime);
      } catch (imgErr) {
        console.warn('Could not embed letterhead image:', imgErr.message);
        // Proceed without letterhead — still return the original PDF
        const pdfBytes  = await srcDoc.save();
        const pdfBuffer = Buffer.from(pdfBytes);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);
      }

      // ── Step 5: prepend background + shift content down on every page ────────
      _step = 'prepend_letterhead_to_pages';

      // Helper: resolve a PDFRef to the actual object.
      // Real-world PDFs store Resources as indirect references (PDFRef),
      // not inline dicts. Calling .get() on a PDFRef throws "not a function".
      const { PDFRef } = require('pdf-lib');
      const resolveRef = (val) =>
        val instanceof PDFRef ? srcDoc.context.lookup(val) : val;

      // How many points to shift content DOWN so it clears the letterhead header.
      // How many points to leave at the bottom so it clears the letterhead footer.
      // Read from query params so they can be tuned without redeploying.
      const CONTENT_OFFSET_TOP    = parseInt(req.query.offset || req.query.top    || '80', 10);
      const CONTENT_OFFSET_BOTTOM = parseInt(req.query.bottom || '60', 10);

      const pages = srcDoc.getPages();

      for (const page of pages) {
        const { width, height } = page.getSize();

        // ── Add letterhead image to XObject resources ─────────────────────
        let resources = resolveRef(page.node.get(PDFName.of('Resources')));
        if (!resources) {
          resources = srcDoc.context.obj({});
          page.node.set(PDFName.of('Resources'), resources);
        }
        let xObjs = resolveRef(resources.get(PDFName.of('XObject')));
        if (!xObjs) {
          xObjs = srcDoc.context.obj({});
          resources.set(PDFName.of('XObject'), xObjs);
        }
        xObjs.set(PDFName.of('LH_BG'), letterheadImage.ref);

        // ── Build streams ─────────────────────────────────────────────────
        // 1. Full-page letterhead background
        const bgOps    = `q\n${width} 0 0 ${height} 0 0 cm\n/LH_BG Do\nQ\n`;
        const bgRef    = srcDoc.context.register(srcDoc.context.flateStream(bgOps));

        // 2. Content transform: scale + translate so content fits within the
        //    safe zone between letterhead header and footer.
        //
        //    PDF CTM: [sx 0 0 sy tx ty]
        //    - sx = 1          → no horizontal scaling
        //    - sy = safeH / h  → compress vertically to fit safe zone
        //    - tx = 0          → no horizontal shift
        //    - ty = bottomOffset → push bottom of scaled content up above footer
        //
        //    The result: content starts at (bottomOffset) from the page bottom
        //    and ends at (height - topOffset) — perfectly inside the letterhead.
        const safeHeight = height - CONTENT_OFFSET_TOP - CONTENT_OFFSET_BOTTOM;
        const sy         = safeHeight / height;
        const ty         = CONTENT_OFFSET_BOTTOM;

        const wrapStartRef = srcDoc.context.register(
          srcDoc.context.flateStream(`q\n1 0 0 ${sy.toFixed(6)} 0 ${ty} cm\n`)
        );
        const wrapEndRef = srcDoc.context.register(
          srcDoc.context.flateStream('Q\n')
        );

        // ── Get existing content refs ─────────────────────────────────────
        const existing = page.node.get(PDFName.of('Contents'));
        let existingRefs;
        if (!existing) {
          existingRefs = [];
        } else if (existing.constructor.name === 'PDFArray') {
          existingRefs = existing.asArray();
        } else {
          existingRefs = [existing];
        }

        // ── Final order: [bg, wrap_start, ...original, wrap_end] ─────────
        const newContents = srcDoc.context.obj([
          bgRef,
          wrapStartRef,
          ...existingRefs,
          wrapEndRef,
        ]);
        page.node.set(PDFName.of('Contents'), newContents);
      }

      // ── Step 6: save and return ────────────────────────────────────────────
      _step = 'save_pdf';
      const pdfBytes  = await srcDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${baseName}_quotation.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // DOCX / DOC PATH — extract text → PDFKit render → letterhead background
    // ════════════════════════════════════════════════════════════════════════════
    _step = 'extract_docx_text';
    let extractedText = '';
    try {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ buffer });
      extractedText = result.value || '';
    } catch (docErr) {
      return res.status(422).json({
        message: isDoc
          ? 'Legacy .doc could not be extracted. Please convert to .docx or PDF.'
          : 'Could not extract text from the document.',
        error: docErr.message,
      });
    }

    if (!extractedText.trim()) {
      return res.status(422).json({ message: 'No text content found in the document.' });
    }

    _step = 'render_docx_pdf';
    const PDFKit = require('pdfkit');
    const doc    = new PDFKit({ size: 'A4', margins: { top: 60, bottom: 60, left: 50, right: 50 } });

    const chunks   = [];
    doc.on('data', c => chunks.push(c));
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

    const PW = 595.28, LM = 50, CW = PW - LM - 50, TOP = 110, BOT = 760;

    const addBg = () => {
      if (letterheadBytes) {
        try { doc.image(letterheadBytes, 0, 0, { width: PW, height: 841.89 }); } catch (_) {}
      }
    };
    addBg();
    doc.y = TOP;
    doc.on('pageAdded', () => { addBg(); doc.y = TOP; });

    for (const rawLine of extractedText.split('\n')) {
      const t = rawLine.trim();
      if (!t) { doc.moveDown(0.4); continue; }
      if (doc.y > BOT - 14) doc.addPage();
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
    console.error(`[SampleQuotation] FAILED at step "${_step}":`, err.stack || err.message);
    return res.status(500).json({
      message: 'Failed to generate sample quotation PDF',
      step: _step,
      error: err.message,
    });
  }
};
