const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

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

// ─── Generic Cloudinary upload helper ────────────────────────────────────────
async function uploadImage(req, res, folder, dbColumn, label) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Delete old file from Cloudinary
    const [rows] = await db.query(`SELECT ${dbColumn} FROM company_settings WHERE id = 1`);
    const oldUrl = rows[0]?.[dbColumn];
    if (oldUrl) {
      const oldPublicId = extractPublicId(oldUrl);
      if (oldPublicId) await deleteFromCloudinary(oldPublicId, 'image');
    }

    // Upload new file
    const { url } = await uploadToCloudinary(req.file.buffer, `crm/${folder}`, 'image');
    await db.query(`UPDATE company_settings SET ${dbColumn} = ? WHERE id = 1`, [url]);

    return res.json({ message: `${label} uploaded`, url });
  } catch (err) {
    console.error(`upload ${label} error:`, err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// ─── Generic Cloudinary remove helper ────────────────────────────────────────
async function removeImage(req, res, dbColumn, label) {
  try {
    const [rows] = await db.query(`SELECT ${dbColumn} FROM company_settings WHERE id = 1`);
    const currentUrl = rows[0]?.[dbColumn];

    if (currentUrl) {
      const publicId = extractPublicId(currentUrl);
      if (publicId) await deleteFromCloudinary(publicId, 'image');
    }

    await db.query(`UPDATE company_settings SET ${dbColumn} = '' WHERE id = 1`);
    return res.json({ message: `${label} removed` });
  } catch (err) {
    console.error(`remove ${label} error:`, err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// ─── Upload endpoints ─────────────────────────────────────────────────────────
exports.uploadLogo       = (req, res) => uploadImage(req, res, 'logos',       'logo_url',       'Logo');
exports.uploadFavicon    = (req, res) => uploadImage(req, res, 'favicons',    'favicon_url',    'Favicon');
exports.uploadUpiQr      = (req, res) => uploadImage(req, res, 'qr-codes',   'upi_qr_url',     'UPI QR');
exports.uploadLetterhead = (req, res) => uploadImage(req, res, 'letterheads', 'letterhead_url', 'Letterhead');
exports.uploadQuotationLetterhead = (req, res) => uploadImage(req, res, 'letterheads', 'quotation_letterhead_url', 'Quotation Letterhead');

// ─── Remove endpoints ─────────────────────────────────────────────────────────
exports.removeLogo       = (req, res) => removeImage(req, res, 'logo_url',       'Logo');
exports.removeFavicon    = (req, res) => removeImage(req, res, 'favicon_url',    'Favicon');
exports.removeUpiQr      = (req, res) => removeImage(req, res, 'upi_qr_url',     'UPI QR');
exports.removeLetterhead = (req, res) => removeImage(req, res, 'letterhead_url', 'Letterhead');
exports.removeQuotationLetterhead = (req, res) => removeImage(req, res, 'quotation_letterhead_url', 'Quotation Letterhead');
exports.removeLetterhead = (req, res) => removeImage(req, res, 'letterhead_url', 'Letterhead');
