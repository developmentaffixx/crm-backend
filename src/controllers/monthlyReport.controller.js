const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');
const { generateWithGemini, fillPromptTemplate } = require('../config/gemini');

// JSON fields that are stored/parsed
const JSON_FIELDS = [
  'platform',
  'content_overview',
  'most_viewed_posts',
  'account_performance',
  'ads_campaigns',
  'most_performed_posts',
  'audience_demographics',
  'recommendations',
];

const VALID_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'twitter'];

// Parse JSON fields from DB row
function parseRow(row) {
  JSON_FIELDS.forEach(f => {
    if (row[f] && typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch (e) { /* leave as-is */ }
    }
  });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST — GET /api/monthly-reports
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { project_id, status, platform, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (project_id) { where += ' AND mr.project_id = ?'; params.push(project_id); }
    if (status) { where += ' AND mr.status = ?'; params.push(status); }
    if (platform) { where += ' AND JSON_CONTAINS(mr.platform, ?)'; params.push(JSON.stringify(platform)); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [rows] = await db.query(
      `SELECT mr.id, mr.project_id, mr.reporting_month, mr.report_date, mr.platform, mr.status, mr.created_at,
              p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE ${where}
       ORDER BY mr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM smm_monthly_reports mr WHERE ${where}`,
      params
    );

    return res.json({ reports: rows, total: countResult[0].total });
  } catch (err) {
    console.error('Monthly report list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ONE — GET /api/monthly-reports/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mr.*, p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });
    return res.json(parseRow(rows[0]));
  } catch (err) {
    console.error('Monthly report getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE — POST /api/monthly-reports
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { project_id, reporting_month } = req.body;

    if (!project_id || !reporting_month) {
      return res.status(400).json({ message: 'Project and reporting month are required' });
    }

    const data = {
      project_id,
      reporting_month,
      created_by: req.user.id,
    };

    // Text fields
    const textFields = ['report_date', 'executive_summary', 'conclusion', 'status'];
    textFields.forEach(f => {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    });

    // JSON fields (includes platform)
    JSON_FIELDS.forEach(f => {
      if (req.body[f] !== undefined) data[f] = JSON.stringify(req.body[f]);
    });

    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const [result] = await db.query(
      `INSERT INTO smm_monthly_reports (${columns}) VALUES (${placeholders})`,
      Object.values(data)
    );

    const [report] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [result.insertId]);
    return res.status(201).json(parseRow(report[0]));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A report already exists for this project, month, and platform.' });
    }
    console.error('Monthly report create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — PUT /api/monthly-reports/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updates = {};
    const textFields = ['report_date', 'executive_summary', 'conclusion', 'status'];
    textFields.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    JSON_FIELDS.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = JSON.stringify(req.body[f]);
    });

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.query(
        `UPDATE smm_monthly_reports SET ${setClauses} WHERE id = ?`,
        [...Object.values(updates), req.params.id]
      );
    }

    const [updated] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    return res.json(parseRow(updated[0]));
  } catch (err) {
    console.error('Monthly report update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — DELETE /api/monthly-reports/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Clean up Cloudinary images
    const report = parseRow(existing[0]);
    const imageUrls = [];

    if (report.most_viewed_posts && Array.isArray(report.most_viewed_posts)) {
      report.most_viewed_posts.forEach(p => { if (p.image_url) imageUrls.push(p.image_url); });
    }
    if (report.most_performed_posts && Array.isArray(report.most_performed_posts)) {
      report.most_performed_posts.forEach(p => { if (p.image_url) imageUrls.push(p.image_url); });
    }

    // Delete images in background (don't block response)
    for (const url of imageUrls) {
      const publicId = extractPublicId(url);
      if (publicId) deleteFromCloudinary(publicId);
    }

    await db.query('DELETE FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('Monthly report delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD IMAGE — POST /api/monthly-reports/upload-image
// Used for most_viewed_posts and most_performed_posts screenshots
// Accepts multipart/form-data with a single file field "image"
// Returns { url, public_id }
// ─────────────────────────────────────────────────────────────────────────────
exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Validate file size (max 1MB)
    if (req.file.size > 1 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image must be less than 1 MB' });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      'crm/monthly-reports',
      'image'
    );

    return res.json({ url: result.url, public_id: result.public_id });
  } catch (err) {
    console.error('Monthly report image upload error:', err);
    return res.status(500).json({ message: 'Failed to upload image' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE IMAGE — DELETE /api/monthly-reports/delete-image
// Body: { public_id }
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteImage = async (req, res) => {
  try {
    const { public_id } = req.body;
    if (!public_id) return res.status(400).json({ message: 'public_id is required' });

    await deleteFromCloudinary(public_id);
    return res.json({ message: 'Image deleted' });
  } catch (err) {
    console.error('Monthly report image delete error:', err);
    return res.status(500).json({ message: 'Failed to delete image' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT PDF — GET /api/monthly-reports/:id/pdf
// Generates landscape PDF with PDFKit (no Chrome needed), returns as download
// ─────────────────────────────────────────────────────────────────────────────
exports.exportPdf = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');

    const [rows] = await db.query(
      `SELECT mr.*, p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });

    const report = parseRow(rows[0]);

    // Landscape slide: 1280x720
    const doc = new PDFDocument({ size: [1280, 720], margin: 0, autoFirstPage: false });

    const filename = `${report.project_title || 'Report'}_${report.reporting_month}.pdf`.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const B = { dark: '#5D3A1A', accent: '#C49A6C', text: '#222222', gray: '#555555', light: '#F8F5F2', line: '#D0D0D0' };
    const monthLabel = report.reporting_month ? new Date(report.reporting_month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() : '';
    const platformLabel = Array.isArray(report.platform) ? report.platform.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') : 'Instagram';

    const addSlide = () => doc.addPage();

    const title = (text, y) => {
      y = y || 50;
      doc.font('Helvetica-Bold').fontSize(38).fillColor(B.dark).text(text, 70, y, { width: 1140 });
      return y + 60;
    };

    const drawTable = (headers, dataRows, startY) => {
      const tableW = 1000;
      const tableX = 70;
      const colW = tableW / headers.length;
      const rowH = 50;
      let y = startY;

      // Header
      doc.rect(tableX, y, tableW, rowH).fill('#F0EDE8');
      headers.forEach((h, i) => {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(B.gray)
          .text(h, tableX + i * colW + 16, y + 16, { width: colW - 32 });
      });
      y += rowH;
      doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor(B.line).lineWidth(1).stroke();

      // Rows
      dataRows.forEach((row) => {
        row.forEach((cell, i) => {
          doc.font('Helvetica-Bold').fontSize(16).fillColor(B.text)
            .text(String(cell || '-'), tableX + i * colW + 16, y + 14, { width: colW - 32 });
        });
        y += rowH;
        doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor('#E8E8E8').lineWidth(0.5).stroke();
      });
      return y;
    };

    // ─── SLIDE 1: Cover ───────────────────────────────────────────────────
    addSlide();
    doc.rect(0, 0, 1280, 720).fill(B.light);
    doc.font('Helvetica-Bold').fontSize(60).fillColor(B.dark)
      .text(report.project_title || report.client_name || 'Monthly Report', 70, 230, { width: 1140, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(42).fillColor(B.accent)
      .text('REPORT', 70, 310, { width: 1140, align: 'center' });
    doc.font('Helvetica').fontSize(22).fillColor('#666')
      .text(monthLabel, 70, 380, { width: 1140, align: 'center' });
    doc.font('Helvetica').fontSize(16).fillColor('#999')
      .text(platformLabel, 70, 415, { width: 1140, align: 'center' });

    // ─── SLIDE 2: Executive Summary ───────────────────────────────────────
    if (report.executive_summary) {
      addSlide();
      const y = title('Executive Summary');
      doc.font('Helvetica').fontSize(16).fillColor(B.text)
        .text(report.executive_summary, 70, y, { width: 1140, lineGap: 8 });
    }

    // ─── SLIDE 3: Content Overview ────────────────────────────────────────
    if (report.content_overview && report.content_overview.length > 0) {
      addSlide();
      const y = title('Content Overview');
      drawTable(
        ['CONTENT TYPE', 'PLANNED', 'PUBLISHED'],
        report.content_overview.map(r => [r.type, r.planned, r.published]),
        y + 10
      );
    }

    // ─── SLIDE 4: Most Viewed Posts ───────────────────────────────────────
    if (report.most_viewed_posts && report.most_viewed_posts.length > 0) {
      for (const [idx, post] of report.most_viewed_posts.entries()) {
        addSlide();
        let y = title(`Most Viewed Post ${idx + 1}`);
        let textX = 70;
        let textW = 1140;

        // Embed image
        if (post.image_url) {
          try {
            const imgBuffer = await fetchImageBuffer(post.image_url);
            if (imgBuffer && imgBuffer.length > 100) {
              doc.image(imgBuffer, 70, y, { width: 280, height: 280, fit: [280, 280] });
              textX = 380;
              textW = 830;
            }
          } catch (e) {
            console.error('Image fetch failed:', post.image_url, e.message);
          }
        }

        let ty = y;
        const lh = 30;
        doc.font('Helvetica-Bold').fontSize(15).fillColor(B.text);
        doc.text(`Views: ${post.views || '-'}  |  Reach: ${post.reach || '-'}`, textX, ty, { width: textW }); ty += lh;
        doc.text(`Likes: ${post.likes || '-'}  |  Comments: ${post.comments || '-'}  |  Shares: ${post.shares || '-'}  |  Saves: ${post.saves || '-'}`, textX, ty, { width: textW }); ty += lh;
        doc.text(`Profile Activities: ${post.profile_activities || '-'}  |  Reposts: ${post.reposts || '-'}`, textX, ty, { width: textW }); ty += lh;
        doc.text(`Followers: ${post.follower_pct || '-'}%  |  Non-Followers: ${post.non_follower_pct || '-'}%`, textX, ty, { width: textW }); ty += lh;
        doc.text(`Gender — Women: ${post.gender_female_pct || '-'}%  |  Men: ${post.gender_male_pct || '-'}%`, textX, ty, { width: textW }); ty += lh + 10;

        if (post.analysis) {
          doc.font('Helvetica').fontSize(13).fillColor(B.gray)
            .text(post.analysis, textX, ty, { width: textW, lineGap: 5 });
        }
      }
    }

    // ─── SLIDE 5: Account Performance ─────────────────────────────────────
    if (report.account_performance) {
      addSlide();
      const y = title('Account Performance');
      const ap = report.account_performance;
      const metrics = [
        ['VIEWS', ap.views, ap.prev_views],
        ['ACCOUNTS REACHED', ap.accounts_reached, ap.prev_accounts_reached],
        ['CONTENT SHARED', ap.content_shared, ap.prev_content_shared],
        ['PROFILE VISITS', ap.profile_visits, ap.prev_profile_visits],
        ['INTERACTIONS', ap.interactions, ap.prev_interactions],
        ['NEW FOLLOWERS', ap.new_followers, ap.prev_new_followers],
        ['EXTERNAL LINK TAPS', ap.external_link_taps, ap.prev_external_link_taps],
      ];
      const hasPrev = metrics.some(m => m[2]);
      const headers = hasPrev ? ['METRIC', 'THIS MONTH', 'PREVIOUS MONTH'] : ['METRIC', 'THIS MONTH'];
      const tableRows = metrics.map(m => hasPrev ? [m[0], m[1], m[2]] : [m[0], m[1]]);
      drawTable(headers, tableRows, y + 10);
    }

    // ─── SLIDE 6: Meta Ads ────────────────────────────────────────────────
    if (report.ads_campaigns && report.ads_campaigns.length > 0) {
      addSlide();
      let y = title('Meta Ads Campaign Results');
      report.ads_campaigns.forEach((camp, i) => {
        doc.font('Helvetica-Bold').fontSize(18).fillColor(B.dark)
          .text(camp.name || `Campaign ${i + 1}`, 70, y, { width: 1140 });
        y += 30;
        doc.font('Helvetica').fontSize(15).fillColor(B.text);
        doc.text(`Ad Budget: Rs.${camp.total_spent || '0'} + GST Rs.${camp.gst_amount || '0'} = Rs.${camp.total_with_gst || '0'}`, 70, y, { width: 1140 }); y += 24;
        doc.text(`Messages: ${camp.messages || '0'}  |  Calls: ${camp.calls || '0'}  |  Total Enquiries: ${camp.enquiries || '0'}`, 70, y, { width: 1140 }); y += 24;
        if (camp.ad_breakdown && camp.ad_breakdown.length > 0) {
          doc.font('Helvetica').fontSize(13).fillColor(B.gray)
            .text('Ad-wise: ' + camp.ad_breakdown.map(b => `${b.creative_name} – ${b.result_count}`).join('  |  '), 70, y, { width: 1140 });
          y += 24;
        }
        y += 20;
      });
    }

    // ─── SLIDE 7: Most Performed Posts ────────────────────────────────────
    if (report.most_performed_posts && report.most_performed_posts.length > 0) {
      addSlide();
      let y = title('Most Performed Posts');
      let px = 70, py = y + 10;
      const imgSize = 200;
      const gap = 20;
      for (const post of report.most_performed_posts) {
        if (px + imgSize + gap > 1210) { px = 70; py += imgSize + 50; }
        if (post.image_url) {
          try {
            const imgBuf = await fetchImageBuffer(post.image_url);
            if (imgBuf && imgBuf.length > 100) {
              doc.image(imgBuf, px, py, { width: imgSize, height: imgSize, fit: [imgSize, imgSize] });
            } else {
              doc.rect(px, py, imgSize, imgSize).fill('#F0F0F0');
            }
          } catch (e) {
            doc.rect(px, py, imgSize, imgSize).fill('#F0F0F0');
          }
        } else {
          doc.rect(px, py, imgSize, imgSize).fill('#F0F0F0');
        }
        doc.font('Helvetica-Bold').fontSize(13).fillColor(B.dark)
          .text(`${post.view_count || '-'} views`, px, py + imgSize + 6, { width: imgSize, align: 'center' });
        px += imgSize + gap;
      }
    }

    // ─── SLIDE 8: Demographics ────────────────────────────────────────────
    if (report.audience_demographics) {
      addSlide();
      let y = title('Audience Demographics');
      const demo = report.audience_demographics;
      let colX = 70;

      if (demo.cities && demo.cities.length > 0) {
        doc.font('Helvetica-Bold').fontSize(18).fillColor(B.dark).text('Top Cities', colX, y + 10);
        let cy = y + 40;
        demo.cities.forEach(c => {
          doc.font('Helvetica').fontSize(15).fillColor(B.text).text(`${c.name}: ${c.pct}%`, colX, cy);
          cy += 26;
        });
        colX += 380;
      }

      if (demo.age_ranges && demo.age_ranges.length > 0) {
        doc.font('Helvetica-Bold').fontSize(18).fillColor(B.dark).text('Age Ranges', colX, y + 10);
        let cy = y + 40;
        demo.age_ranges.forEach(a => {
          doc.font('Helvetica').fontSize(15).fillColor(B.text).text(`${a.range}: ${a.pct}%`, colX, cy);
          cy += 26;
        });
        colX += 380;
      }

      if (demo.gender) {
        doc.font('Helvetica-Bold').fontSize(18).fillColor(B.dark).text('Gender', colX, y + 10);
        doc.font('Helvetica').fontSize(15).fillColor(B.text)
          .text(`Women: ${demo.gender.female_pct || '-'}%`, colX, y + 40)
          .text(`Men: ${demo.gender.male_pct || '-'}%`, colX, y + 66);
      }
    }

    // ─── SLIDE 9: Recommendations ─────────────────────────────────────────
    if (report.recommendations && report.recommendations.filter(r => r).length > 0) {
      addSlide();
      let y = title('Recommendations for Next Month');
      y += 10;
      report.recommendations.filter(r => r).forEach((rec) => {
        doc.font('Helvetica-Bold').fontSize(16).fillColor(B.accent).text('✓', 70, y);
        doc.font('Helvetica').fontSize(16).fillColor(B.text).text(rec, 100, y, { width: 1100 });
        y += 40;
      });
    }

    // ─── SLIDE 10: Conclusion ─────────────────────────────────────────────
    if (report.conclusion) {
      addSlide();
      const y = title('Conclusion');
      doc.font('Helvetica').fontSize(16).fillColor(B.text)
        .text(report.conclusion, 70, y, { width: 1140, lineGap: 8 });
    }

    doc.end();
  } catch (err) {
    console.error('Monthly report PDF export error:', err.message, err.stack);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Failed to generate PDF: ' + err.message });
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT PPTX — POST /api/monthly-reports/:id/pptx
// Takes AI-generated content + report data → builds PPTX slide deck
// Body: { ai_content } (the AI-generated JSON from /generate endpoint)
// ─────────────────────────────────────────────────────────────────────────────
exports.exportPptx = async (req, res) => {
  try {
    const PptxGenJS = require('pptxgenjs');
    const { ai_content } = req.body;

    // Fetch report
    const [rows] = await db.query(
      `SELECT mr.*, p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });

    const report = parseRow(rows[0]);
    const monthLabel = report.reporting_month ? new Date(report.reporting_month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() : '';
    const platformLabel = Array.isArray(report.platform) ? report.platform.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') : 'Instagram';

    // Create presentation
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches (16:9)
    pptx.author = 'Affixx Media';
    pptx.title = `${report.project_title || 'Report'} - ${monthLabel}`;

    const brandDark = '5D3A1A';
    const brandAccent = 'C49A6C';
    const textColor = '222222';
    const grayColor = '555555';

    // ─── SLIDE 1: Cover ─────────────────────────────────────────────────
    let slide = pptx.addSlide();
    slide.background = { color: 'F8F5F2' };
    slide.addText(report.project_title || report.client_name || 'Monthly Report', { x: 0.5, y: 2.2, w: 12.3, h: 1.2, fontSize: 44, bold: true, color: brandDark, align: 'center', fontFace: 'Arial' });
    slide.addText('REPORT', { x: 0.5, y: 3.3, w: 12.3, h: 0.8, fontSize: 32, bold: true, color: brandAccent, align: 'center', fontFace: 'Arial' });
    slide.addText(monthLabel, { x: 0.5, y: 4.2, w: 12.3, h: 0.5, fontSize: 18, color: '666666', align: 'center', fontFace: 'Arial' });
    slide.addText(platformLabel, { x: 0.5, y: 4.7, w: 12.3, h: 0.4, fontSize: 14, color: '999999', align: 'center', fontFace: 'Arial' });

    // ─── SLIDE 2: Executive Summary ─────────────────────────────────────
    if (ai_content?.executive_summary) {
      slide = pptx.addSlide();
      slide.addText('Executive Summary', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });
      slide.addText(ai_content.executive_summary, { x: 0.6, y: 1.2, w: 12, h: 5.8, fontSize: 15, color: textColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.4 });
    }

    // ─── SLIDE 3: Content Overview ──────────────────────────────────────
    if (report.content_overview && report.content_overview.length > 0) {
      slide = pptx.addSlide();
      slide.addText('Content Overview', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

      const tableRows = [
        [{ text: 'CONTENT TYPE', options: { bold: true, fontSize: 12, color: '555555', fill: { color: 'F0EDE8' } } }, { text: 'PLANNED', options: { bold: true, fontSize: 12, color: '555555', fill: { color: 'F0EDE8' } } }, { text: 'PUBLISHED', options: { bold: true, fontSize: 12, color: '555555', fill: { color: 'F0EDE8' } } }],
        ...report.content_overview.map(r => [
          { text: r.type, options: { fontSize: 14, bold: true } },
          { text: String(r.planned || '-'), options: { fontSize: 14, bold: true, align: 'center' } },
          { text: String(r.published || '-'), options: { fontSize: 14, bold: true, align: 'center' } },
        ])
      ];
      slide.addTable(tableRows, { x: 0.6, y: 1.4, w: 10, h: 3, border: { type: 'solid', color: 'DDDDDD', pt: 1 }, colW: [4, 3, 3], rowH: [0.5, 0.6, 0.6, 0.6, 0.6] });

      if (ai_content?.content_analysis) {
        slide.addText(ai_content.content_analysis, { x: 0.6, y: 5.0, w: 12, h: 2, fontSize: 13, color: grayColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.3 });
      }
    }

    // ─── SLIDE 4: Most Viewed Posts ─────────────────────────────────────
    if (report.most_viewed_posts && report.most_viewed_posts.length > 0) {
      for (const [idx, post] of report.most_viewed_posts.entries()) {
        slide = pptx.addSlide();
        slide.addText(`Most Viewed Post ${idx + 1}`, { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

        // Image
        let textX = 0.6, textW = 12;
        if (post.image_url) {
          try {
            const imgBuf = await fetchImageBuffer(post.image_url);
            if (imgBuf && imgBuf.length > 100) {
              const base64 = imgBuf.toString('base64');
              const ext = post.image_url.includes('.png') ? 'png' : 'jpeg';
              slide.addImage({ data: `image/${ext};base64,${base64}`, x: 0.6, y: 1.3, w: 3.0, h: 3.0 });
              textX = 4.0;
              textW = 8.7;
            }
          } catch (e) { /* skip */ }
        }

        // Metrics
        const metrics = [
          `Views: ${post.views || '-'}  |  Reach: ${post.reach || '-'}`,
          `Likes: ${post.likes || '-'}  |  Comments: ${post.comments || '-'}  |  Shares: ${post.shares || '-'}  |  Saves: ${post.saves || '-'}`,
          `Profile Activities: ${post.profile_activities || '-'}  |  Reposts: ${post.reposts || '-'}`,
          `Followers: ${post.follower_pct || '-'}%  |  Non-Followers: ${post.non_follower_pct || '-'}%`,
          `Gender — Women: ${post.gender_female_pct || '-'}%  |  Men: ${post.gender_male_pct || '-'}%`,
        ].join('\n');
        slide.addText(metrics, { x: textX, y: 1.3, w: textW, h: 2.2, fontSize: 13, color: textColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.5 });

        // AI analysis
        const analysis = ai_content?.post_analysis?.[idx] || post.analysis || '';
        if (analysis) {
          slide.addText(analysis, { x: textX, y: 3.8, w: textW, h: 3.2, fontSize: 12, color: grayColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.3 });
        }
      }
    }

    // ─── SLIDE 5: Account Performance ───────────────────────────────────
    if (report.account_performance) {
      slide = pptx.addSlide();
      slide.addText('Account Performance', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

      const ap = report.account_performance;
      const metrics = [
        ['VIEWS', ap.views], ['ACCOUNTS REACHED', ap.accounts_reached], ['CONTENT SHARED', ap.content_shared],
        ['PROFILE VISITS', ap.profile_visits], ['INTERACTIONS', ap.interactions], ['NEW FOLLOWERS', ap.new_followers], ['EXTERNAL LINK TAPS', ap.external_link_taps],
      ];
      const hasPrev = metrics.some((_, i) => ap[`prev_${['views','accounts_reached','content_shared','profile_visits','interactions','new_followers','external_link_taps'][i]}`]);

      const headers = hasPrev
        ? [{ text: 'METRIC', options: { bold: true, fontSize: 11, fill: { color: 'F0EDE8' } } }, { text: 'THIS MONTH', options: { bold: true, fontSize: 11, fill: { color: 'F0EDE8' }, align: 'center' } }, { text: 'PREVIOUS', options: { bold: true, fontSize: 11, fill: { color: 'F0EDE8' }, align: 'center' } }]
        : [{ text: 'METRIC', options: { bold: true, fontSize: 11, fill: { color: 'F0EDE8' } } }, { text: 'THIS MONTH', options: { bold: true, fontSize: 11, fill: { color: 'F0EDE8' }, align: 'center' } }];

      const keys = ['views','accounts_reached','content_shared','profile_visits','interactions','new_followers','external_link_taps'];
      const dataRows = metrics.map((m, i) => {
        const row = [{ text: m[0], options: { fontSize: 13, bold: true } }, { text: String(m[1] || '-'), options: { fontSize: 14, bold: true, align: 'center' } }];
        if (hasPrev) row.push({ text: String(ap[`prev_${keys[i]}`] || '-'), options: { fontSize: 13, align: 'center' } });
        return row;
      });

      slide.addTable([headers, ...dataRows], { x: 0.6, y: 1.4, w: hasPrev ? 10 : 8, border: { type: 'solid', color: 'DDDDDD', pt: 1 }, rowH: [0.45, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] });

      if (ai_content?.performance_insights) {
        slide.addText(ai_content.performance_insights, { x: 0.6, y: 5.6, w: 12, h: 1.5, fontSize: 12, color: grayColor, fontFace: 'Arial', valign: 'top' });
      }
    }

    // ─── SLIDE 6: Meta Ads ──────────────────────────────────────────────
    if (report.ads_campaigns && report.ads_campaigns.length > 0) {
      slide = pptx.addSlide();
      slide.addText('Meta Ads Campaign Results', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

      let yPos = 1.3;
      report.ads_campaigns.forEach((camp, i) => {
        slide.addText(camp.name || `Campaign ${i + 1}`, { x: 0.6, y: yPos, w: 12, h: 0.4, fontSize: 16, bold: true, color: brandDark, fontFace: 'Arial' });
        yPos += 0.45;
        slide.addText(`Ad Budget: Rs.${camp.total_spent || '0'} + GST Rs.${camp.gst_amount || '0'} = Rs.${camp.total_with_gst || '0'}`, { x: 0.6, y: yPos, w: 12, h: 0.35, fontSize: 13, color: textColor, fontFace: 'Arial' });
        yPos += 0.35;
        slide.addText(`Messages: ${camp.messages || '0'}  |  Calls: ${camp.calls || '0'}  |  Total Enquiries: ${camp.enquiries || '0'}`, { x: 0.6, y: yPos, w: 12, h: 0.35, fontSize: 13, color: textColor, fontFace: 'Arial' });
        yPos += 0.35;
        if (camp.ad_breakdown && camp.ad_breakdown.length > 0) {
          slide.addText('Ad-wise: ' + camp.ad_breakdown.map(b => `${b.creative_name} – ${b.result_count}`).join('  |  '), { x: 0.6, y: yPos, w: 12, h: 0.3, fontSize: 11, color: grayColor, fontFace: 'Arial' });
          yPos += 0.35;
        }
        yPos += 0.3;
      });

      if (ai_content?.ads_conclusion) {
        slide.addText(ai_content.ads_conclusion, { x: 0.6, y: Math.min(yPos, 5.5), w: 12, h: 1.5, fontSize: 12, color: grayColor, fontFace: 'Arial', valign: 'top' });
      }
    }

    // ─── SLIDE 7: Most Performed Posts Grid ─────────────────────────────
    if (report.most_performed_posts && report.most_performed_posts.length > 0) {
      slide = pptx.addSlide();
      slide.addText('Most Performed Posts', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

      let px = 0.6, py = 1.3;
      for (const post of report.most_performed_posts) {
        if (px + 2.5 > 12.5) { px = 0.6; py += 2.8; }
        if (post.image_url) {
          try {
            const imgBuf = await fetchImageBuffer(post.image_url);
            if (imgBuf && imgBuf.length > 100) {
              const ext = post.image_url.includes('.png') ? 'png' : 'jpeg';
              slide.addImage({ data: `image/${ext};base64,${imgBuf.toString('base64')}`, x: px, y: py, w: 2.2, h: 2.2 });
            }
          } catch (e) { /* skip */ }
        }
        slide.addText(`${post.view_count || '-'} views`, { x: px, y: py + 2.25, w: 2.2, h: 0.35, fontSize: 11, bold: true, color: brandDark, align: 'center', fontFace: 'Arial' });
        px += 2.5;
      }
    }

    // ─── SLIDE 8: Demographics ──────────────────────────────────────────
    if (report.audience_demographics) {
      slide = pptx.addSlide();
      slide.addText('Audience Demographics', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

      const demo = report.audience_demographics;
      let colX = 0.6;

      if (demo.cities && demo.cities.length > 0) {
        slide.addText('Top Cities', { x: colX, y: 1.3, w: 4, h: 0.4, fontSize: 16, bold: true, color: brandDark, fontFace: 'Arial' });
        const cityText = demo.cities.map(c => `${c.name}: ${c.pct}%`).join('\n');
        slide.addText(cityText, { x: colX, y: 1.8, w: 4, h: 3, fontSize: 14, color: textColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.5 });
        colX += 4.2;
      }

      if (demo.age_ranges && demo.age_ranges.length > 0) {
        slide.addText('Age Ranges', { x: colX, y: 1.3, w: 4, h: 0.4, fontSize: 16, bold: true, color: brandDark, fontFace: 'Arial' });
        const ageText = demo.age_ranges.map(a => `${a.range}: ${a.pct}%`).join('\n');
        slide.addText(ageText, { x: colX, y: 1.8, w: 4, h: 3, fontSize: 14, color: textColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.5 });
        colX += 4.2;
      }

      if (demo.gender) {
        slide.addText('Gender', { x: colX, y: 1.3, w: 3.5, h: 0.4, fontSize: 16, bold: true, color: brandDark, fontFace: 'Arial' });
        slide.addText(`Women: ${demo.gender.female_pct || '-'}%\nMen: ${demo.gender.male_pct || '-'}%`, { x: colX, y: 1.8, w: 3.5, h: 1.5, fontSize: 14, color: textColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.5 });
      }

      if (ai_content?.demographic_insights) {
        slide.addText(ai_content.demographic_insights, { x: 0.6, y: 5.5, w: 12, h: 1.5, fontSize: 12, color: grayColor, fontFace: 'Arial', valign: 'top' });
      }
    }

    // ─── SLIDE 9: Recommendations ───────────────────────────────────────
    const recs = ai_content?.recommendations_polished || report.recommendations || [];
    if (recs.filter(r => r).length > 0) {
      slide = pptx.addSlide();
      slide.addText('Recommendations for Next Month', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });

      let ry = 1.4;
      recs.filter(r => r).forEach((rec) => {
        slide.addText('✓', { x: 0.6, y: ry, w: 0.4, h: 0.4, fontSize: 16, color: brandAccent, fontFace: 'Arial' });
        slide.addText(rec, { x: 1.1, y: ry, w: 11.5, h: 0.4, fontSize: 15, color: textColor, fontFace: 'Arial' });
        ry += 0.55;
      });
    }

    // ─── SLIDE 10: Conclusion ───────────────────────────────────────────
    if (ai_content?.conclusion) {
      slide = pptx.addSlide();
      slide.addText('Conclusion', { x: 0.6, y: 0.4, w: 12, h: 0.7, fontSize: 30, bold: true, color: brandDark, fontFace: 'Arial' });
      slide.addText(ai_content.conclusion, { x: 0.6, y: 1.3, w: 12, h: 5.5, fontSize: 15, color: textColor, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.4 });
    }

    // Generate and send
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
    const fname = `${report.project_title || 'Report'}_${report.reporting_month}.pptx`.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(pptxBuffer);
  } catch (err) {
    console.error('PPTX export error:', err.message, err.stack);
    return res.status(500).json({ message: 'Failed to generate PPTX: ' + err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE AI REPORT — POST /api/monthly-reports/:id/generate
// Takes report data + prompt template → sends to Gemini → returns AI content
// Body: { template_id }
// ─────────────────────────────────────────────────────────────────────────────
exports.generateAI = async (req, res) => {
  try {
    const { template_id } = req.body;
    if (!template_id) return res.status(400).json({ message: 'template_id is required' });

    // Fetch report with project/client info
    const [rows] = await db.query(
      `SELECT mr.*, p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });

    const report = parseRow(rows[0]);

    // Fetch prompt template
    const [templates] = await db.query('SELECT * FROM mpr_prompt_templates WHERE id = ? AND is_active = 1', [template_id]);
    if (templates.length === 0) return res.status(404).json({ message: 'Prompt template not found' });

    const template = templates[0];

    // Fill placeholders in prompt with report data
    const filledPrompt = fillPromptTemplate(template.prompt_body, report);

    // Send to Gemini
    const aiResponse = await generateWithGemini(filledPrompt);

    // Parse AI response as JSON
    let aiContent;
    try {
      // Remove markdown code fences if present
      let cleaned = aiResponse.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      aiContent = JSON.parse(cleaned.trim());
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', aiResponse.substring(0, 500));
      return res.status(500).json({ message: 'AI returned invalid format. Please try again.', raw: aiResponse.substring(0, 1000) });
    }

    // Return the AI-generated content along with original report data (for preview/export)
    return res.json({
      report,
      ai_content: aiContent,
      template_name: template.name,
    });
  } catch (err) {
    console.error('Generate AI report error:', err.message);
    return res.status(500).json({ message: 'AI generation failed: ' + err.message });
  }
};

// Helper: fetch image from URL as buffer with timeout and redirect support
function fetchImageBuffer(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (!url || maxRedirects <= 0) return reject(new Error('No URL or too many redirects'));

    const client = url.startsWith('https') ? require('https') : require('http');
    const request = client.get(url, { timeout: 10000 }, (response) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) return reject(new Error('Redirect with no location'));
        return fetchImageBuffer(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length < 100) return reject(new Error('Image too small'));
        resolve(buffer);
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
  });
}
