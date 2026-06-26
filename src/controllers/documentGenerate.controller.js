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

    // Register Noto Sans font (supports ₹ and other Unicode characters)
    const fontsDir = path.join(__dirname, '../../fonts');
    const notoRegularPath = path.join(fontsDir, 'NotoSans-Regular.ttf');
    const notoBoldPath = path.join(fontsDir, 'NotoSans-Bold.ttf');
    const notoItalicPath = path.join(fontsDir, 'NotoSans-Italic.ttf');
    const notoBoldItalicPath = path.join(fontsDir, 'NotoSans-BoldItalic.ttf');
    
    const hasNotoRegular = fs.existsSync(notoRegularPath);
    const hasNotoBold = fs.existsSync(notoBoldPath);
    const hasNotoItalic = fs.existsSync(notoItalicPath);
    const hasNotoBoldItalic = fs.existsSync(notoBoldItalicPath);

    // Font names to use throughout
    const FONT_REGULAR = hasNotoRegular ? 'NotoSans' : 'Helvetica';
    const FONT_BOLD = hasNotoBold ? 'NotoSans-Bold' : 'Helvetica-Bold';
    const FONT_ITALIC = hasNotoItalic ? 'NotoSans-Italic' : 'Helvetica-Oblique';
    const FONT_BOLD_ITALIC = hasNotoBoldItalic ? 'NotoSans-BoldItalic' : 'Helvetica-BoldOblique';

    if (hasNotoRegular) doc.registerFont('NotoSans', notoRegularPath);
    if (hasNotoBold) doc.registerFont('NotoSans-Bold', notoBoldPath);
    if (hasNotoItalic) doc.registerFont('NotoSans-Italic', notoItalicPath);
    if (hasNotoBoldItalic) doc.registerFont('NotoSans-BoldItalic', notoBoldItalicPath);

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
    const LEFT_MARGIN = 50;
    const RIGHT_MARGIN = 50;
    const PAGE_WIDTH = 595.28;
    const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;

    // Decode HTML entities
    const decodeEntities = (text) => {
      return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, '\u2019')
        .replace(/&lsquo;/g, '\u2018')
        .replace(/&rdquo;/g, '\u201D')
        .replace(/&ldquo;/g, '\u201C')
        .replace(/&ndash;/g, '\u2013')
        .replace(/&mdash;/g, '\u2014')
        .replace(/&nbsp;/g, ' ')
        .replace(/&hellip;/g, '\u2026')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
        .replace(/&rupee;/g, '\u20B9');
    };

    // Strip HTML tags
    const stripTags = (html) => html.replace(/<[^>]+>/g, '');

    // Convert <br> to newlines, strip tags, decode entities
    const cleanText = (html) => {
      let text = html.replace(/<br\s*\/?>/gi, '\n');
      text = stripTags(text);
      text = decodeEntities(text);
      return text.trim();
    };

    // Parse inline segments from an HTML line (handles <strong>, <em>, <b>, <i>)
    const parseInlineSegments = (htmlLine) => {
      const segments = [];
      const regex = /<(strong|b|em|i)>([\s\S]*?)<\/\1>|([^<]+)|<[^>]+>/gi;
      let match;
      
      while ((match = regex.exec(htmlLine)) !== null) {
        if (match[1]) {
          const tag = match[1].toLowerCase();
          const text = decodeEntities(stripTags(match[2]));
          if (text) {
            const isBold = tag === 'strong' || tag === 'b';
            const isItalic = tag === 'em' || tag === 'i';
            let font = FONT_REGULAR;
            if (isBold && isItalic) font = FONT_BOLD_ITALIC;
            else if (isBold) font = FONT_BOLD;
            else if (isItalic) font = FONT_ITALIC;
            segments.push({ text, font });
          }
        } else if (match[3]) {
          const text = decodeEntities(match[3]);
          if (text) {
            segments.push({ text, font: FONT_REGULAR });
          }
        }
      }
      return segments;
    };

    // Render a single line with mixed fonts
    const renderLineSegments = (segments, options = {}) => {
      const { fontSize = 10, align = 'justify', lineGap = 3 } = options;
      
      if (segments.length === 0) return;

      doc.fontSize(fontSize);

      // If all segments are same font, render as simple text
      const allSameFont = segments.every(s => s.font === segments[0].font);
      if (allSameFont) {
        const fullText = segments.map(s => s.text).join('');
        doc.font(segments[0].font).text(fullText, LEFT_MARGIN, doc.y, { 
          width: CONTENT_WIDTH, align, lineGap 
        });
        return;
      }

      // For mixed fonts, use 'left' align to avoid justify spacing issues with continued text
      doc.x = LEFT_MARGIN;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;
        doc.font(seg.font);
        if (isLast) {
          doc.text(seg.text, { width: CONTENT_WIDTH, align: 'left', lineGap, continued: false });
        } else {
          doc.text(seg.text, { width: CONTENT_WIDTH, align: 'left', lineGap, continued: true });
        }
      }
    };

    // Render rich text (handles <strong>, <em>, <br> inside a block)
    const renderRichText = (html, options = {}) => {
      const { fontSize = 10, align = 'justify', lineGap = 3 } = options;
      
      // Split by <br> into separate lines
      const lines = html.split(/<br\s*\/?>/gi);
      
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx].trim();
        if (!line) {
          doc.moveDown(0.3);
          continue;
        }

        const segments = parseInlineSegments(line);
        
        if (segments.length === 0) {
          // Fallback: plain text
          const text = decodeEntities(stripTags(line)).trim();
          if (text) {
            doc.fontSize(fontSize).font(FONT_REGULAR).text(text, LEFT_MARGIN, doc.y, { 
              width: CONTENT_WIDTH, align, lineGap 
            });
          }
        } else {
          renderLineSegments(segments, { fontSize, align, lineGap });
        }
      }
    };

    // Check if we need a new page (with bottom margin for letterhead footer)
    const checkNewPage = (minSpace = 0) => { 
      if (doc.y > (700 - minSpace)) {
        doc.addPage(); 
      }
    };

    // Reset x position to left margin (fixes table alignment issues)
    const resetX = () => { doc.x = LEFT_MARGIN; };

    // Split content into meaningful sections
    const sections = content.split(/(?=<h[12][^>]*>)|(?=<p[^>]*>)|(?=<table)|(?=<hr)|(?=<ul)|(?=<ol)/gi);

    for (const section of sections) {
      if (!section.trim()) continue;

      checkNewPage();
      resetX();

      if (section.match(/^<h1/i)) {
        const text = cleanText(section);
        if (text) {
          checkNewPage(60); // Ensure space for heading + at least some content
          doc.moveDown(0.5);
          doc.fontSize(16).font(FONT_BOLD).text(text, LEFT_MARGIN, doc.y, { 
            width: CONTENT_WIDTH, align: 'center' 
          });
          doc.moveDown(0.5);
        }
      } else if (section.match(/^<h2/i)) {
        const text = cleanText(section);
        if (text) {
          checkNewPage(60); // Ensure space for heading + at least some content
          doc.moveDown(0.5);
          doc.fontSize(12).font(FONT_BOLD).text(text, LEFT_MARGIN, doc.y, { 
            width: CONTENT_WIDTH 
          });
          doc.moveDown(0.3);
        }
      } else if (section.match(/^<hr/i)) {
        doc.moveDown(0.5);
        doc.moveTo(LEFT_MARGIN, doc.y).lineTo(PAGE_WIDTH - RIGHT_MARGIN, doc.y).strokeColor('#dddddd').stroke();
        doc.moveDown(0.5);
      } else if (section.match(/^<table/i)) {
        // Parse table rows
        const rowMatches = section.match(/<tr[\s\S]*?<\/tr>/gi) || [];
        const tableX = LEFT_MARGIN;
        
        for (const row of rowMatches) {
          checkNewPage();
          const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(c => cleanText(c));
          if (cells.length >= 2) {
            const isHeader = /<th/i.test(row);
            doc.fontSize(9).font(isHeader ? FONT_BOLD : FONT_REGULAR);
            const colWidth = CONTENT_WIDTH / cells.length;
            const startY = doc.y;
            
            // Calculate max height needed for this row
            let maxHeight = 14;
            cells.forEach((cell, i) => {
              const h = doc.heightOfString(cell, { width: colWidth - 10 });
              if (h > maxHeight) maxHeight = h;
            });

            // Draw cell borders and text
            cells.forEach((cell, i) => {
              const cellX = tableX + (i * colWidth);
              // Draw cell border
              doc.rect(cellX, startY, colWidth, maxHeight + 8).strokeColor('#cccccc').stroke();
              // Draw cell text
              doc.fillColor('#000000').text(cell, cellX + 5, startY + 4, { 
                width: colWidth - 10, align: 'left' 
              });
            });
            
            doc.y = startY + maxHeight + 8;
          }
        }
        doc.moveDown(0.5);
        resetX();
      } else if (section.match(/^<[uo]l/i)) {
        const items = (section.match(/<li[\s\S]*?<\/li>/gi) || []).map(li => cleanText(li));
        items.forEach(item => {
          checkNewPage();
          doc.fontSize(10).font(FONT_REGULAR).text(`  •  ${item}`, LEFT_MARGIN, doc.y, { 
            width: CONTENT_WIDTH, indent: 15, lineGap: 2 
          });
          doc.moveDown(0.15);
        });
        doc.moveDown(0.3);
      } else if (section.match(/^<p/i)) {
        // Check if paragraph contains inline formatting or line breaks
        const hasInline = /<(strong|b|em|i)\b/i.test(section);
        const hasBr = /<br\s*\/?>/i.test(section);
        const innerHtml = section.replace(/^<p[^>]*>/i, '').replace(/<\/p>$/i, '').trim();
        
        if (!innerHtml) continue;
        
        if (hasInline || hasBr) {
          renderRichText(innerHtml, { fontSize: 10, align: 'justify', lineGap: 3 });
        } else {
          const text = cleanText(section);
          if (text) {
            doc.fontSize(10).font(FONT_REGULAR).text(text, LEFT_MARGIN, doc.y, { 
              width: CONTENT_WIDTH, align: 'justify', lineGap: 3 
            });
          }
        }
        doc.moveDown(0.3);
      } else {
        // Plain text fallback
        const text = cleanText(section);
        if (text) {
          doc.fontSize(10).font(FONT_REGULAR).text(text, LEFT_MARGIN, doc.y, { 
            width: CONTENT_WIDTH, lineGap: 3 
          });
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
