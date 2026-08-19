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
// Generates landscape PDF with branded styling, returns as download
// ─────────────────────────────────────────────────────────────────────────────
exports.exportPdf = async (req, res) => {
  let browser = null;
  try {
    const puppeteer = require('puppeteer');

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

    // Build HTML for the PDF
    const html = buildPdfHtml(report);

    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pdfBuffer = await page.pdf({
      width: '1280px',
      height: '720px',
      printBackground: true,
      landscape: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await browser.close();

    const filename = `${report.project_title || 'Report'}_${report.reporting_month}.pdf`.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    if (browser) try { await browser.close(); } catch(e) {}
    console.error('Monthly report PDF export error:', err.message, err.stack);
    return res.status(500).json({ message: 'Failed to generate PDF: ' + err.message });
  }
};

// ─── PDF HTML BUILDER ────────────────────────────────────────────────────────

function buildPdfHtml(report) {
  const brandColor = '#5D3A1A';
  const accentColor = '#C49A6C';
  const monthLabel = report.reporting_month ? new Date(report.reporting_month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() : '';
  const platformLabel = Array.isArray(report.platform)
    ? report.platform.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
    : (report.platform || 'Instagram');

  // Helper for slides
  const slide = (content) => `<div class="slide">${content}</div>`;

  let slides = '';

  // ─── SLIDE 1: Cover ─────────────────────────────────────────────────────
  slides += slide(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;">
      <h1 style="font-size:56px;font-weight:800;color:${brandColor};margin:0;letter-spacing:-1px;">${report.project_title || report.client_name || 'Monthly Report'}</h1>
      <h2 style="font-size:36px;font-weight:700;color:${accentColor};margin:10px 0 0;">REPORT</h2>
      <p style="font-size:20px;color:#666;margin-top:20px;">${monthLabel}</p>
      <p style="font-size:14px;color:#999;margin-top:8px;">${platformLabel}</p>
    </div>
  `);

  // ─── SLIDE 2: Executive Summary ─────────────────────────────────────────
  if (report.executive_summary) {
    slides += slide(`
      <h2 class="slide-title">Executive Summary</h2>
      <div class="slide-body"><p>${(report.executive_summary || '').replace(/\n/g, '</p><p>')}</p></div>
    `);
  }

  // ─── SLIDE 3: Content Overview ──────────────────────────────────────────
  if (report.content_overview && report.content_overview.length > 0) {
    let tableRows = report.content_overview.map(r =>
      `<tr><td>${r.type}</td><td><strong>${r.planned || '-'}</strong></td><td><strong>${r.published || '-'}</strong></td></tr>`
    ).join('');
    slides += slide(`
      <h2 class="slide-title">Content Overview</h2>
      <table class="data-table">
        <thead><tr><th>CONTENT TYPE</th><th>PLANNED</th><th>PUBLISHED</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    `);
  }

  // ─── SLIDE 4: Most Viewed Posts ─────────────────────────────────────────
  if (report.most_viewed_posts && report.most_viewed_posts.length > 0) {
    report.most_viewed_posts.forEach((post, idx) => {
      const imgHtml = post.image_url ? `<img src="${post.image_url}" style="width:250px;height:250px;object-fit:cover;border-radius:12px;flex-shrink:0;" />` : '';
      slides += slide(`
        <h2 class="slide-title">Most Viewed Post ${idx + 1}</h2>
        <div style="display:flex;gap:30px;align-items:flex-start;">
          ${imgHtml}
          <div style="flex:1;font-size:13px;line-height:1.7;color:#333;">
            <p><strong>Views:</strong> ${post.views || '-'} | <strong>Reach:</strong> ${post.reach || '-'}</p>
            <p><strong>Likes:</strong> ${post.likes || '-'} | <strong>Comments:</strong> ${post.comments || '-'} | <strong>Shares:</strong> ${post.shares || '-'} | <strong>Saves:</strong> ${post.saves || '-'}</p>
            <p><strong>Profile Activities:</strong> ${post.profile_activities || '-'} | <strong>Reposts:</strong> ${post.reposts || '-'}</p>
            <p><strong>Followers:</strong> ${post.follower_pct || '-'}% | <strong>Non-Followers:</strong> ${post.non_follower_pct || '-'}%</p>
            <p><strong>Gender:</strong> Women ${post.gender_female_pct || '-'}% | Men ${post.gender_male_pct || '-'}%</p>
            ${post.analysis ? `<p style="margin-top:12px;">${post.analysis}</p>` : ''}
          </div>
        </div>
      `);
    });
  }

  // ─── SLIDE 5: Account Performance ───────────────────────────────────────
  if (report.account_performance) {
    const ap = report.account_performance;
    const metrics = [
      { label: 'VIEWS', key: 'views' },
      { label: 'ACCOUNTS REACHED', key: 'accounts_reached' },
      { label: 'CONTENT SHARED', key: 'content_shared' },
      { label: 'PROFILE VISITS', key: 'profile_visits' },
      { label: 'INTERACTIONS', key: 'interactions' },
      { label: 'NEW FOLLOWERS', key: 'new_followers' },
      { label: 'EXTERNAL LINK TAPS', key: 'external_link_taps' },
    ];
    const hasPrev = metrics.some(m => ap[`prev_${m.key}`]);
    let tableRows = metrics.map(m => {
      let row = `<tr><td>${m.label}</td><td><strong>${ap[m.key] || '-'}</strong></td>`;
      if (hasPrev) row += `<td>${ap[`prev_${m.key}`] || '-'}</td>`;
      row += '</tr>';
      return row;
    }).join('');
    slides += slide(`
      <h2 class="slide-title">Account Performance</h2>
      <table class="data-table">
        <thead><tr><th>METRIC</th><th>THIS MONTH</th>${hasPrev ? '<th>PREVIOUS MONTH</th>' : ''}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    `);
  }

  // ─── SLIDE 6: Meta Ads ──────────────────────────────────────────────────
  if (report.ads_campaigns && report.ads_campaigns.length > 0) {
    let adsContent = '';
    report.ads_campaigns.forEach((camp, i) => {
      adsContent += `<div style="margin-bottom:24px;">`;
      adsContent += `<h3 style="font-size:16px;color:${brandColor};margin:0 0 8px;">${camp.name || `Campaign ${i + 1}`}</h3>`;
      adsContent += `<p style="font-size:13px;color:#555;">Ad Budget: ₹${camp.total_spent || '0'} + GST ₹${camp.gst_amount || '0'} = ₹${camp.total_with_gst || '0'}</p>`;
      adsContent += `<p style="font-size:13px;color:#555;">Messages: ${camp.messages || '0'} | Calls: ${camp.calls || '0'} | Total Enquiries: ${camp.enquiries || '0'}</p>`;
      if (camp.ad_breakdown && camp.ad_breakdown.length > 0) {
        adsContent += `<p style="font-size:12px;color:#888;margin-top:6px;"><strong>Ad-wise:</strong> ${camp.ad_breakdown.map(b => `${b.creative_name} – ${b.result_count}`).join(' | ')}</p>`;
      }
      adsContent += `</div>`;
    });
    slides += slide(`<h2 class="slide-title">Meta Ads Campaign Results</h2><div class="slide-body">${adsContent}</div>`);
  }

  // ─── SLIDE 7: Most Performed Posts ──────────────────────────────────────
  if (report.most_performed_posts && report.most_performed_posts.length > 0) {
    let grid = report.most_performed_posts.map(p =>
      `<div style="text-align:center;">
        ${p.image_url ? `<img src="${p.image_url}" style="width:180px;height:180px;object-fit:cover;border-radius:8px;" />` : '<div style="width:180px;height:180px;background:#f0f0f0;border-radius:8px;"></div>'}
        <p style="margin:6px 0 0;font-size:12px;font-weight:700;color:${brandColor};">↗ ${p.view_count || '-'}</p>
      </div>`
    ).join('');
    slides += slide(`<h2 class="slide-title">Most Performed Posts</h2><div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;">${grid}</div>`);
  }

  // ─── SLIDE 8: Audience Demographics ─────────────────────────────────────
  if (report.audience_demographics) {
    const demo = report.audience_demographics;
    let demoContent = '<div style="display:flex;gap:40px;justify-content:center;">';
    // Cities
    if (demo.cities && demo.cities.length > 0) {
      demoContent += `<div><h4 style="font-size:14px;color:${brandColor};margin-bottom:8px;">Top Cities</h4>`;
      demo.cities.forEach(c => { demoContent += `<p style="font-size:13px;color:#555;">${c.name}: <strong>${c.pct}%</strong></p>`; });
      demoContent += '</div>';
    }
    // Age
    if (demo.age_ranges && demo.age_ranges.length > 0) {
      demoContent += `<div><h4 style="font-size:14px;color:${brandColor};margin-bottom:8px;">Age Ranges</h4>`;
      demo.age_ranges.forEach(a => { demoContent += `<p style="font-size:13px;color:#555;">${a.range}: <strong>${a.pct}%</strong></p>`; });
      demoContent += '</div>';
    }
    // Gender
    if (demo.gender) {
      demoContent += `<div><h4 style="font-size:14px;color:${brandColor};margin-bottom:8px;">Gender</h4>`;
      demoContent += `<p style="font-size:13px;color:#555;">Women: <strong>${demo.gender.female_pct || '-'}%</strong></p>`;
      demoContent += `<p style="font-size:13px;color:#555;">Men: <strong>${demo.gender.male_pct || '-'}%</strong></p>`;
      demoContent += '</div>';
    }
    demoContent += '</div>';
    slides += slide(`<h2 class="slide-title">Audience Demographics</h2>${demoContent}`);
  }

  // ─── SLIDE 9: Recommendations ───────────────────────────────────────────
  if (report.recommendations && report.recommendations.length > 0) {
    const recList = report.recommendations.filter(r => r).map(r => `<li style="margin-bottom:12px;font-size:15px;color:#333;">${r}</li>`).join('');
    slides += slide(`<h2 class="slide-title">Recommendations for Next Month</h2><ul style="list-style:none;padding:0;">${recList.replace(/<li/g, '<li style="padding-left:28px;position:relative;margin-bottom:12px;font-size:15px;color:#333;"><span style="position:absolute;left:0;color:' + accentColor + ';">✓</span>')}</ul>`);
  }

  // ─── SLIDE 10: Conclusion ───────────────────────────────────────────────
  if (report.conclusion) {
    slides += slide(`
      <h2 class="slide-title">Conclusion</h2>
      <div class="slide-body"><p>${(report.conclusion || '').replace(/\n/g, '</p><p>')}</p></div>
    `);
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, sans-serif; background: white; }
  .slide {
    width: 1280px; height: 720px; padding: 60px 80px;
    page-break-after: always; position: relative; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center;
  }
  .slide-title {
    font-size: 32px; font-weight: 700; color: ${brandColor};
    margin-bottom: 24px; letter-spacing: -0.5px;
  }
  .slide-body { font-size: 15px; line-height: 1.8; color: #444; }
  .slide-body p { margin-bottom: 12px; }
  .data-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .data-table th { text-align: left; padding: 14px 20px; background: #f8f8f8; border: 1px solid #e0e0e0; font-size: 12px; font-weight: 700; color: #555; letter-spacing: 0.5px; }
  .data-table td { padding: 14px 20px; border: 1px solid #e0e0e0; font-size: 14px; color: #333; }
  .data-table tr:nth-child(even) td { background: #fafafa; }
</style>
</head>
<body>${slides}</body>
</html>`;
}
