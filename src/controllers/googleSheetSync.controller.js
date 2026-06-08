const { google } = require('googleapis');
const db = require('../config/db');

// ─── Helper: Get Financial Year key (Apr–Mar) ────────────────────────────────
function getFinancialYearKey(date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  return `${String(fyStart).slice(-2)}${String(fyEnd).slice(-2)}`;
}

// ─── Helper: Generate Lead ID (same logic as leads controller) ───────────────
async function generateLeadId(connection, customDate) {
  const now = customDate ? new Date(customDate) : new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const fyKey = getFinancialYearKey(now);
  const prefix = `LD-${yy}${mm}${dd}`;

  const conn = connection || db;
  await conn.query(
    `INSERT INTO lead_id_sequence (ym_key, last_seq) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    [fyKey]
  );

  const [rows] = await conn.query(
    'SELECT last_seq FROM lead_id_sequence WHERE ym_key = ?',
    [fyKey]
  );
  const seq = String(rows[0].last_seq).padStart(3, '0');
  return `${prefix}-${seq}`;
}

// ─── Helper: Get authenticated Google Sheets client ──────────────────────────
function getSheetsClient() {
  // Build credentials from individual env variables
  const credentials = {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── Helper: Normalize column header to match DB field ───────────────────────
function normalizeHeader(header) {
  const map = {
    'name': 'name',
    'business name': 'business_name',
    'businessname': 'business_name',
    'business_name': 'business_name',
    'phone': 'phone',
    'phone number': 'phone',
    'industry': 'industry',
    'services': 'service_required',
    'service': 'service_required',
    'service required': 'service_required',
    'service_required': 'service_required',
    'resource': 'resource',
    'temperature': 'temperature',
    'temp': 'temperature',
    'social link': 'social_link',
    'social_link': 'social_link',
    'sociallink': 'social_link',
    'address': 'address',
    'email': 'email',
    'source': 'source',
    'status': 'status',
  };
  return map[header.toLowerCase().trim()] || null;
}

/**
 * POST /api/leads/sync-google-sheet
 * Body: { spreadsheetId, sheetName? }
 * Reads rows from the Google Sheet and inserts new leads (skips duplicates by phone)
 */
exports.syncFromGoogleSheet = async (req, res) => {
  const { spreadsheetId, sheetName } = req.body;

  if (!spreadsheetId) {
    return res.status(400).json({ message: 'Spreadsheet ID is required' });
  }

  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return res.status(500).json({ message: 'Google service account not configured on server. Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY.' });
  }

  try {
    const sheets = getSheetsClient();
    const range = sheetName ? `${sheetName}!A:Z` : 'A:Z';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.json({ added: 0, skipped: 0, errors: [], message: 'No data rows found in the sheet' });
    }

    // First row = headers
    const headers = rows[0].map(h => normalizeHeader(h));
    const dataRows = rows.slice(1);

    // Get existing phone numbers to check duplicates
    const [existingLeads] = await db.query(
      'SELECT phone FROM leads WHERE deleted = 0 AND phone IS NOT NULL AND phone != ""'
    );
    const existingPhones = new Set(existingLeads.map(l => l.phone?.replace(/\D/g, '')));

    let added = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // 1-indexed + header row

      // Build lead object from row
      const lead = {};
      headers.forEach((field, idx) => {
        if (field && row[idx]) {
          lead[field] = row[idx].trim();
        }
      });

      // Validate: name is required
      if (!lead.name) {
        errors.push({ row: rowNum, reason: 'Name is missing' });
        continue;
      }

      // Skip empty rows
      if (Object.keys(lead).length === 0) continue;

      // Check duplicate by phone (if phone provided)
      if (lead.phone) {
        const cleanPhone = lead.phone.replace(/\D/g, '');
        if (existingPhones.has(cleanPhone)) {
          skipped++;
          continue;
        }
        existingPhones.add(cleanPhone); // prevent duplicates within the same sheet
      }

      // Normalize temperature
      if (lead.temperature) {
        const temp = lead.temperature.toLowerCase();
        if (['hot', 'warm', 'cold'].includes(temp)) {
          lead.temperature = temp;
        } else {
          lead.temperature = 'cold';
        }
      }

      try {
        const lead_id = await generateLeadId(null, null);

        // Handle social link — store as a social_links entry
        const socialLink = lead.social_link;
        delete lead.social_link;

        await db.query(
          `INSERT INTO leads (lead_id, name, business_name, industry, service_required, phone, email,
            address, temperature, source, resource, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            lead_id,
            lead.name,
            lead.business_name || null,
            lead.industry || null,
            lead.service_required || null,
            lead.phone || null,
            lead.email || null,
            lead.address || null,
            lead.temperature || 'cold',
            lead.source || null,
            lead.resource || null,
            lead.status || 'New',
            req.user.id,
          ]
        );

        const insertId = (await db.query('SELECT LAST_INSERT_ID() as id'))[0][0].id;

        // Insert social link if provided
        if (socialLink) {
          // Auto-detect platform from URL
          let platform = 'Website';
          const url = socialLink.toLowerCase();
          if (url.includes('linkedin')) platform = 'LinkedIn';
          else if (url.includes('instagram')) platform = 'Instagram';
          else if (url.includes('facebook')) platform = 'Facebook';
          else if (url.includes('twitter') || url.includes('x.com')) platform = 'Twitter';

          await db.query(
            'INSERT INTO lead_social_links (lead_id, platform, url) VALUES (?, ?, ?)',
            [insertId, platform, socialLink]
          );
        }

        // Record initial status in history
        await db.query(
          'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
          [insertId, '', lead.status || 'New', req.user.id]
        );

        added++;
      } catch (insertErr) {
        console.error(`Sheet sync - row ${rowNum} insert error:`, insertErr);
        errors.push({ row: rowNum, reason: 'Database insert failed' });
      }
    }

    return res.json({
      added,
      skipped,
      errors,
      message: `Sync complete: ${added} leads added, ${skipped} duplicates skipped${errors.length ? `, ${errors.length} errors` : ''}`,
    });
  } catch (err) {
    console.error('Google Sheet sync error:', err);

    if (err.code === 404) {
      return res.status(404).json({ message: 'Spreadsheet not found. Check the Sheet ID and make sure it is shared with the service account.' });
    }
    if (err.code === 403) {
      return res.status(403).json({ message: 'Access denied. Make sure the Google Sheet is shared with the service account email.' });
    }

    return res.status(500).json({ message: err.message || 'Failed to sync from Google Sheet' });
  }
};
