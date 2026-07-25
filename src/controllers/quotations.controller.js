const db = require('../config/db');
const { sendRawEmail } = require('../services/email.service');

// ─── Helper: Generate quotation number ────────────────────────────────────────
// Format: QTN-YYMM-###
async function generateQuotationNumber() {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [count] = await db.query(
    `SELECT COUNT(*) AS cnt FROM quotations WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?`,
    [now.getFullYear(), now.getMonth() + 1]
  );
  const seq = String((count[0]?.cnt || 0) + 1).padStart(3, '0');
  return `QTN-${yymm}-${seq}`;
}

// ─── GET /api/quotations ──────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = 'q.deleted = 0';
    const params = [];

    if (status) { where += ' AND q.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (q.quotation_number LIKE ? OR q.client_name LIKE ? OR q.service_title LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT q.*, l.name AS lead_name, l.business_name AS lead_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM quotations q
       LEFT JOIN leads l ON l.id = q.lead_id
       LEFT JOIN users u ON u.id = q.created_by
       WHERE ${where}
       ORDER BY q.created_at DESC`,
      params
    );

    return res.json({ quotations: rows });
  } catch (err) {
    console.error('Quotations list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/quotations/:id ──────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT q.*, l.name AS lead_name, l.business_name AS lead_business,
              l.email AS lead_email, l.phone AS lead_phone,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM quotations q
       LEFT JOIN leads l ON l.id = q.lead_id
       LEFT JOIN users u ON u.id = q.created_by
       WHERE q.id = ? AND q.deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Quotation not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Quotation getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/quotations ─────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      lead_id, client_name, client_email, client_phone,
      service_title, tagline, description,
      process_sections, plan_title, plan_includes,
      investment_amount, investment_label,
      terms, bank_name, account_number, ifsc_code, branch, upi_id
    } = req.body;

    if (!client_name || !service_title) {
      return res.status(400).json({ message: 'Client name and service title are required' });
    }

    const quotation_number = await generateQuotationNumber();

    const [result] = await db.query(
      `INSERT INTO quotations (quotation_number, lead_id, client_name, client_email, client_phone,
        service_title, tagline, description, process_sections, plan_title, plan_includes,
        investment_amount, investment_label, terms,
        bank_name, account_number, ifsc_code, branch, upi_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation_number,
        lead_id || null,
        client_name,
        client_email || null,
        client_phone || null,
        service_title,
        tagline || null,
        description || null,
        JSON.stringify(process_sections || []),
        plan_title || 'Monthly Growth Plan',
        JSON.stringify(plan_includes || []),
        parseFloat(investment_amount) || 0,
        investment_label || '/ Month',
        JSON.stringify(terms || []),
        bank_name || null,
        account_number || null,
        ifsc_code || null,
        branch || null,
        upi_id || null,
        req.user.id
      ]
    );

    const [created] = await db.query('SELECT * FROM quotations WHERE id = ?', [result.insertId]);
    res.emitSocket('quotations:created', created[0]);
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Quotation create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/quotations/:id ──────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM quotations WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Quotation not found' });

    const {
      lead_id, client_name, client_email, client_phone,
      service_title, tagline, description,
      process_sections, plan_title, plan_includes,
      investment_amount, investment_label,
      terms, bank_name, account_number, ifsc_code, branch, upi_id, status
    } = req.body;

    await db.query(
      `UPDATE quotations SET
        lead_id = ?, client_name = ?, client_email = ?, client_phone = ?,
        service_title = ?, tagline = ?, description = ?,
        process_sections = ?, plan_title = ?, plan_includes = ?,
        investment_amount = ?, investment_label = ?, terms = ?,
        bank_name = ?, account_number = ?, ifsc_code = ?, branch = ?, upi_id = ?, status = ?
       WHERE id = ?`,
      [
        lead_id !== undefined ? lead_id : existing[0].lead_id,
        client_name || existing[0].client_name,
        client_email !== undefined ? client_email : existing[0].client_email,
        client_phone !== undefined ? client_phone : existing[0].client_phone,
        service_title || existing[0].service_title,
        tagline !== undefined ? tagline : existing[0].tagline,
        description !== undefined ? description : existing[0].description,
        JSON.stringify(process_sections || JSON.parse(existing[0].process_sections || '[]')),
        plan_title || existing[0].plan_title,
        JSON.stringify(plan_includes || JSON.parse(existing[0].plan_includes || '[]')),
        investment_amount !== undefined ? parseFloat(investment_amount) : existing[0].investment_amount,
        investment_label || existing[0].investment_label,
        JSON.stringify(terms || JSON.parse(existing[0].terms || '[]')),
        bank_name !== undefined ? bank_name : existing[0].bank_name,
        account_number !== undefined ? account_number : existing[0].account_number,
        ifsc_code !== undefined ? ifsc_code : existing[0].ifsc_code,
        branch !== undefined ? branch : existing[0].branch,
        upi_id !== undefined ? upi_id : existing[0].upi_id,
        status || existing[0].status,
        req.params.id
      ]
    );

    const [updated] = await db.query('SELECT * FROM quotations WHERE id = ?', [req.params.id]);
    res.emitSocket('quotations:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Quotation update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/quotations/:id (soft) ────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM quotations WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Quotation not found' });

    await db.query('UPDATE quotations SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('quotations:deleted', { id: req.params.id });
    return res.json({ message: 'Quotation deleted' });
  } catch (err) {
    console.error('Quotation delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/quotations/:id/send-email ──────────────────────────────────────
exports.sendEmail = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT q.*, l.email AS lead_email FROM quotations q
       LEFT JOIN leads l ON l.id = q.lead_id
       WHERE q.id = ? AND q.deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Quotation not found' });

    const quotation = rows[0];
    const toEmail = quotation.client_email || quotation.lead_email;
    if (!toEmail) {
      return res.status(400).json({ message: 'No email address found for this client' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required' });
    }

    // Get company settings
    const [compRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const comp = compRows[0] || {};

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:20px;background:#ffffff;">
<div style="max-width:550px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
  <div style="background:#1a1a1a;color:#fff;padding:24px;text-align:center;">
    <h1 style="margin:0;font-size:18px;font-weight:300;letter-spacing:3px;text-transform:uppercase;">Quotation</h1>
    <p style="margin:6px 0 0;font-size:12px;opacity:0.7;">${comp.company_name || 'Company'}</p>
  </div>
  <div style="padding:24px;">
    <p style="font-size:14px;color:#333;margin:0 0 12px;">Dear <strong>${quotation.client_name}</strong>,</p>
    <p style="font-size:13px;color:#555;margin:0 0 20px;line-height:1.6;">
      Thank you for your interest. Please find attached our quotation for <strong>${quotation.service_title}</strong>.
    </p>
    <div style="background:#f5f5f5;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:4px 0;font-size:12px;color:#888;">Quotation No.</td>
          <td style="padding:4px 0;font-size:13px;font-weight:700;color:#333;text-align:right;">${quotation.quotation_number}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:12px;color:#888;">Service</td>
          <td style="padding:4px 0;font-size:13px;color:#333;text-align:right;">${quotation.service_title}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:12px;color:#888;">Investment</td>
          <td style="padding:4px 0;font-size:14px;font-weight:700;color:#333;text-align:right;">₹${Number(quotation.investment_amount).toLocaleString('en-IN')} ${quotation.investment_label || '/ Month'}</td>
        </tr>
      </table>
    </div>
    <p style="font-size:11px;color:#999;margin:0;">The detailed quotation is attached as a PDF.</p>
  </div>
  <div style="padding:14px 24px;text-align:center;border-top:1px solid #eee;">
    <p style="margin:0;font-size:10px;color:#aaa;">${comp.company_name || ''}</p>
  </div>
</div>
</body>
</html>`;

    await sendRawEmail({
      to: toEmail,
      subject: `Quotation ${quotation.quotation_number} — ${quotation.service_title}`,
      html: emailHtml,
      attachments: [
        {
          filename: `${quotation.quotation_number}.pdf`,
          content: req.file.buffer,
          contentType: 'application/pdf',
        }
      ],
    });

    // Update status to Sent
    await db.query('UPDATE quotations SET status = "Sent" WHERE id = ? AND status = "Draft"', [req.params.id]);

    return res.json({ message: 'Quotation emailed successfully' });
  } catch (err) {
    console.error('Send quotation email error:', err);
    return res.status(500).json({ message: err.message || 'Failed to send email' });
  }
};
