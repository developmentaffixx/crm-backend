const db = require('../config/db');
const path = require('path');
const fs   = require('fs');

// ─── GET /api/settings/company ────────────────────────────────────────────────
exports.getCompanySettings = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    if (!rows.length) return res.status(404).json({ message: 'Company settings not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('getCompanySettings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/settings/company ────────────────────────────────────────────────
exports.updateCompanySettings = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const current = existing[0] || {};

    // All updatable fields
    const fields = [
      'company_name', 'tagline', 'email', 'phone', 'website',
      'address_line1', 'address_line2', 'city', 'state', 'zip_code', 'country',
      'gst_number', 'tax_id', 'registration_no',
      'timezone', 'date_format', 'currency', 'currency_symbol', 'financial_year_start',
      'social_linkedin', 'social_instagram', 'social_twitter', 'social_facebook',
      'bank_name', 'bank_branch', 'bank_account_no', 'bank_ifsc', 'bank_swift', 'bank_account_type',
      'upi_id',
    ];

    const updated = {};
    fields.forEach(f => {
      updated[f] = req.body[f] !== undefined ? req.body[f] : (current[f] ?? '');
    });

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updated[f]);

    await db.query(`UPDATE company_settings SET ${setClauses} WHERE id = 1`, values);

    return res.json({ message: 'Company settings saved' });
  } catch (err) {
    console.error('updateCompanySettings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── Generic image upload helper ──────────────────────────────────────────────
async function uploadImage(req, res, fieldName, dbColumn) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const filename = `${fieldName}-${Date.now()}${path.extname(req.file.originalname)}`;
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const url = `/uploads/${filename}`;
    await db.query(`UPDATE company_settings SET ${dbColumn} = ? WHERE id = 1`, [url]);

    return res.json({ message: `${fieldName} uploaded`, url });
  } catch (err) {
    console.error(`upload ${fieldName} error:`, err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// ─── Remove image helper ──────────────────────────────────────────────────────
async function removeImage(req, res, dbColumn, label) {
  try {
    const [rows] = await db.query(`SELECT ${dbColumn} FROM company_settings WHERE id = 1`);
    const currentUrl = rows[0]?.[dbColumn];

    // Delete file from disk if it exists
    if (currentUrl) {
      const filepath = path.join(__dirname, '../../', currentUrl);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }

    await db.query(`UPDATE company_settings SET ${dbColumn} = '' WHERE id = 1`, []);
    return res.json({ message: `${label} removed` });
  } catch (err) {
    console.error(`remove ${label} error:`, err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// ─── Upload endpoints ─────────────────────────────────────────────────────────
exports.uploadLogo       = (req, res) => uploadImage(req, res, 'logo', 'logo_url');
exports.uploadFavicon    = (req, res) => uploadImage(req, res, 'favicon', 'favicon_url');
exports.uploadUpiQr      = (req, res) => uploadImage(req, res, 'upi-qr', 'upi_qr_url');
exports.uploadLetterhead = (req, res) => uploadImage(req, res, 'letterhead', 'letterhead_url');

// ─── Remove endpoints ─────────────────────────────────────────────────────────
exports.removeLogo       = (req, res) => removeImage(req, res, 'logo_url', 'Logo');
exports.removeFavicon    = (req, res) => removeImage(req, res, 'favicon_url', 'Favicon');
exports.removeUpiQr      = (req, res) => removeImage(req, res, 'upi_qr_url', 'UPI QR');
exports.removeLetterhead = (req, res) => removeImage(req, res, 'letterhead_url', 'Letterhead');
