const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

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
    const https = require('https');
    const http = require('http');

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

    // Create landscape PDF (1280x720 points like a slide)
    const doc = new PDFDocument({ size: [1280, 720], margin: 0, autoFirstPage: false });

    const filename = `${report.project_title || 'Report'}_${report.reporting_month}.pdf`.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const brand = { dark: '#5D3A1A', accent: '#C49A6C', text: '#333333', light: '#F8F5F2' };
    const monthLabel = report.reporting_month ? new Date(report.reporting_month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() : '';
    const platformLabel = Array.isArray(report.platform) ? report.platform.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') : 'Instagram';

    // Helper: add a new slide page
    const addSlide = () => { doc.addPage(); };

    // Helper: draw slide title
    const slideTitle = (title) => {
      doc.font('Helvetica-Bold').fontSize(30).fillColor(brand.dark).text(title, 80, 60, { width: 1120 });
      return 110;
    };

    // Helper: draw table
    const drawTable = (headers, rows, startY) => {
      const colWidth = 1120 / headers.length;
      let y = startY;

      // Header row
      doc.rect(80, y, 1120, 36).fill('#F3F3F3');
      headers.forEach((h, i) => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#555').text(h, 80 + i * colWidth + 14, y + 12, { width: colWidth - 28 });
      });
      y += 36;

      // Data rows
      rows.forEach((row, rIdx) => {
        if (rIdx % 2 === 1) doc.rect(80, y, 1120, 34).fill('#FAFAFA');
        row.forEach((cell, i) => {
          doc.font('Helvetica').fontSize(12).fillColor(brand.text).text(String(cell || '-'), 80 + i * colWidth + 14, y + 10, { width: colWidth - 28 });
        });
        y += 34;
        doc.moveTo(80, y).lineTo(1200, y).strokeColor('#E5E5E5').lineWidth(0.5).stroke();
      });
      return y;
    };

    // ─── SLIDE 1: Cover ───────────────────────────────────────────────────
    addSlide();
    doc.rect(0, 0, 1280, 720).fill(brand.light);
    doc.font('Helvetica-Bold').fontSize(52).fillColor(brand.dark)
      .text(report.project_title || report.client_name || 'Monthly Report', 80, 240, { width: 1120, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(34).fillColor(brand.accent)
      .text('REPORT', 80, 310, { width: 1120, align: 'center' });
    doc.font('Helvetica').fontSize(18).fillColor('#666')
      .text(monthLabel, 80, 370, { width: 1120, align: 'center' });
    doc.font('Helvetica').fontSize(13).fillColor('#999')
      .text(platformLabel, 80, 400, { width: 1120, align: 'center' });

    // ─── SLIDE 2: Executive Summary ───────────────────────────────────────
    if (report.executive_summary) {
      addSlide();
      const y = slideTitle('Executive Summary');
      doc.font('Helvetica').fontSize(13).fillColor(brand.text)
        .text(report.executive_summary, 80, y, { width: 1120, lineGap: 6 });
    }

    // ─── SLIDE 3: Content Overview ────────────────────────────────────────
    if (report.content_overview && report.content_overview.length > 0) {
      addSlide();
      const y = slideTitle('Content Overview');
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
        const y = slideTitle(`Most Viewed Post ${idx + 1}`);
        let textX = 80;
        let textW = 1120;

        // Try to fetch and embed image
        if (post.image_url) {
          try {
            const imgBuffer = await fetchImageBuffer(post.image_url);
            doc.image(imgBuffer, 80, y, { width: 220, height: 220 });
            textX = 320;
            textW = 880;
          } catch (e) { /* skip image if fetch fails */ }
        }

        let ty = y;
        doc.font('Helvetica').fontSize(12).fillColor(brand.text);
        doc.text(`Views: ${post.views || '-'}  |  Reach: ${post.reach || '-'}`, textX, ty, { width: textW }); ty += 22;
        doc.text(`Likes: ${post.likes || '-'}  |  Comments: ${post.comments || '-'}  |  Shares: ${post.shares || '-'}  |  Saves: ${post.saves || '-'}`, textX, ty, { width: textW }); ty += 22;
        doc.text(`Profile Activities: ${post.profile_activities || '-'}  |  Reposts: ${post.reposts || '-'}`, textX, ty, { width: textW }); ty += 22;
        doc.text(`Followers: ${post.follower_pct || '-'}%  |  Non-Followers: ${post.non_follower_pct || '-'}%`, textX, ty, { width: textW }); ty += 22;
        doc.text(`Gender — Women: ${post.gender_female_pct || '-'}%  |  Men: ${post.gender_male_pct || '-'}%`, textX, ty, { width: textW }); ty += 30;

        if (post.analysis) {
          doc.font('Helvetica').fontSize(11).fillColor('#555')
            .text(post.analysis, textX, ty, { width: textW, lineGap: 4 });
        }
      }
    }

    // ─── SLIDE 5: Account Performance ─────────────────────────────────────
    if (report.account_performance) {
      addSlide();
      const y = slideTitle('Account Performance');
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
      let y = slideTitle('Meta Ads Campaign Results');
      report.ads_campaigns.forEach((camp, i) => {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(brand.dark)
          .text(camp.name || `Campaign ${i + 1}`, 80, y, { width: 1120 });
        y += 22;
        doc.font('Helvetica').fontSize(12).fillColor(brand.text);
        doc.text(`Ad Budget: Rs.${camp.total_spent || '0'} + GST Rs.${camp.gst_amount || '0'} = Rs.${camp.total_with_gst || '0'}`, 80, y, { width: 1120 }); y += 18;
        doc.text(`Messages: ${camp.messages || '0'}  |  Calls: ${camp.calls || '0'}  |  Total Enquiries: ${camp.enquiries || '0'}`, 80, y, { width: 1120 }); y += 18;
        if (camp.ad_breakdown && camp.ad_breakdown.length > 0) {
          doc.font('Helvetica').fontSize(11).fillColor('#777')
            .text('Ad-wise: ' + camp.ad_breakdown.map(b => `${b.creative_name} – ${b.result_count}`).join('  |  '), 80, y, { width: 1120 });
          y += 18;
        }
        y += 16;
      });
    }

    // ─── SLIDE 7: Most Performed Posts ────────────────────────────────────
    if (report.most_performed_posts && report.most_performed_posts.length > 0) {
      addSlide();
      const y = slideTitle('Most Performed Posts');
      let px = 80, py = y + 10;
      for (const post of report.most_performed_posts) {
        if (px + 190 > 1200) { px = 80; py += 210; }
        if (post.image_url) {
          try {
            const imgBuf = await fetchImageBuffer(post.image_url);
            doc.image(imgBuf, px, py, { width: 170, height: 170 });
          } catch (e) {
            doc.rect(px, py, 170, 170).fill('#F0F0F0');
          }
        } else {
          doc.rect(px, py, 170, 170).fill('#F0F0F0');
        }
        doc.font('Helvetica-Bold').fontSize(11).fillColor(brand.dark)
          .text(`${post.view_count || '-'} views`, px, py + 175, { width: 170, align: 'center' });
        px += 190;
      }
    }

    // ─── SLIDE 8: Demographics ────────────────────────────────────────────
    if (report.audience_demographics) {
      addSlide();
      let y = slideTitle('Audience Demographics');
      const demo = report.audience_demographics;
      let colX = 80;

      // Cities
      if (demo.cities && demo.cities.length > 0) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor(brand.dark).text('Top Cities', colX, y + 10);
        let cy = y + 30;
        demo.cities.forEach(c => {
          doc.font('Helvetica').fontSize(12).fillColor(brand.text).text(`${c.name}: ${c.pct}%`, colX, cy);
          cy += 20;
        });
        colX += 350;
      }

      // Age Ranges
      if (demo.age_ranges && demo.age_ranges.length > 0) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor(brand.dark).text('Age Ranges', colX, y + 10);
        let cy = y + 30;
        demo.age_ranges.forEach(a => {
          doc.font('Helvetica').fontSize(12).fillColor(brand.text).text(`${a.range}: ${a.pct}%`, colX, cy);
          cy += 20;
        });
        colX += 350;
      }

      // Gender
      if (demo.gender) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor(brand.dark).text('Gender', colX, y + 10);
        doc.font('Helvetica').fontSize(12).fillColor(brand.text)
          .text(`Women: ${demo.gender.female_pct || '-'}%`, colX, y + 30)
          .text(`Men: ${demo.gender.male_pct || '-'}%`, colX, y + 50);
      }
    }

    // ─── SLIDE 9: Recommendations ─────────────────────────────────────────
    if (report.recommendations && report.recommendations.filter(r => r).length > 0) {
      addSlide();
      let y = slideTitle('Recommendations for Next Month');
      report.recommendations.filter(r => r).forEach((rec, i) => {
        doc.font('Helvetica').fontSize(14).fillColor(brand.accent).text('✓', 80, y + 6);
        doc.font('Helvetica').fontSize(14).fillColor(brand.text).text(rec, 110, y + 4, { width: 1090 });
        y += 36;
      });
    }

    // ─── SLIDE 10: Conclusion ─────────────────────────────────────────────
    if (report.conclusion) {
      addSlide();
      const y = slideTitle('Conclusion');
      doc.font('Helvetica').fontSize(13).fillColor(brand.text)
        .text(report.conclusion, 80, y, { width: 1120, lineGap: 6 });
    }

    doc.end();
  } catch (err) {
    console.error('Monthly report PDF export error:', err.message, err.stack);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Failed to generate PDF: ' + err.message });
    }
  }
};

// Helper: fetch image from URL as buffer (for embedding in PDFKit)
function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? require('https') : require('http');
    client.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return fetchImageBuffer(response.headers.location).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}
