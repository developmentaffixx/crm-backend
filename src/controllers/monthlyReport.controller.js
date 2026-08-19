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
