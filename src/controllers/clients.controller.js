const db = require('../config/db');
const path = require('path');
const fs = require('fs');

/**
 * GET /api/clients
 * Returns all leads with status = 'Won' (i.e. converted clients)
 */
exports.list = async (req, res) => {
  try {
    const { search } = req.query;
    let where = "l.deleted = 0 AND l.status = 'Won'";
    const params = [];

    if (search) {
      where += ' AND (l.name LIKE ? OR l.business_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    // Non-admin: only see clients assigned to or created by them
    if (!req.user.is_admin) {
      where += ' AND (l.assigned_to = ? OR l.created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE ${where}
       ORDER BY l.updated_at DESC`,
      params
    );

    return res.json({ clients: rows, total: rows.length });
  } catch (err) {
    console.error('Clients list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/clients/:id
 * Returns full client detail with related projects, invoices, follow-ups
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE l.id = ? AND l.deleted = 0 AND l.status = 'Won'`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Client not found' });

    const client = rows[0];

    // Non-admin access check
    if (!req.user.is_admin && client.assigned_to !== req.user.id && client.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch social links
    const [links] = await db.query('SELECT * FROM lead_social_links WHERE lead_id = ?', [client.id]);
    client.social_links = links;

    // Fetch follow-ups
    const [followUps] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = ?
       ORDER BY f.created_at DESC`,
      [client.id]
    );
    client.follow_ups = followUps;

    // Fetch related projects
    const [projects] = await db.query(
      `SELECT p.id, p.title, p.status, p.start_date, p.end_date, p.project_type
       FROM projects p
       WHERE p.client_id = ? AND p.deleted = 0
       ORDER BY p.created_at DESC`,
      [client.id]
    );
    client.projects = projects;

    // Fetch related invoices
    const [invoices] = await db.query(
      `SELECT i.id, i.invoice_number, i.status, i.bill_date, i.due_date, i.total_amount, i.paid_amount, i.balance_amount
       FROM invoices i
       WHERE i.lead_id = ? AND i.deleted = 0
       ORDER BY i.created_at DESC`,
      [client.id]
    );
    client.invoices = invoices;

    // Fetch related expenses
    const [expenses] = await db.query(
      `SELECT e.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.client_id = ? AND e.deleted = 0
       ORDER BY e.expense_date DESC`,
      [client.id]
    );
    client.expenses = expenses;

    // Fetch related tasks (via project_tasks junction)
    const [tasks] = await db.query(
      `SELECT t.id, t.title, t.status, t.priority, t.deadline, t.is_active,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tasks t
       INNER JOIN project_tasks pt ON pt.task_id = t.id
       INNER JOIN projects p ON p.id = pt.project_id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE p.client_id = ? AND t.deleted = 0
       ORDER BY t.created_at DESC`,
      [client.id]
    );
    client.tasks = tasks;

    // Fetch related tickets
    const [tickets] = await db.query(
      `SELECT tk.id, tk.title, tk.status, tk.priority, tk.ticket_type, tk.due_date,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.assigned_to
       WHERE tk.related_to_type = 'client' AND tk.related_to_id = ? AND tk.deleted = 0
       ORDER BY tk.created_at DESC`,
      [client.id]
    );
    client.tickets = tickets;

    // Fetch related shoots
    const [shoots] = await db.query(
      `SELECT s.id, s.project_campaign_name, s.shoot_date, s.start_time, s.end_time,
              s.location_type, s.city, s.status, s.shoot_status
       FROM shoots s
       WHERE s.client_brand_id = ? AND s.deleted = 0
       ORDER BY s.shoot_date DESC`,
      [client.id]
    );
    client.shoots = shoots;

    // Fetch onboarding A
    const [onbA] = await db.query('SELECT * FROM client_onboarding_a WHERE client_id = ?', [client.id]);
    client.onboarding_a = onbA.length > 0 ? onbA[0] : null;

    // Fetch onboarding B
    const [onbB] = await db.query('SELECT * FROM client_onboarding_b WHERE client_id = ?', [client.id]);
    client.onboarding_b = onbB.length > 0 ? onbB[0] : null;

    // Fetch client files
    const [files] = await db.query(
      `SELECT cf.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM client_files cf
       LEFT JOIN users u ON u.id = cf.uploaded_by
       WHERE cf.client_id = ?
       ORDER BY cf.created_at DESC`,
      [client.id]
    );
    client.files = files;

    // Fetch client folders
    const [folders] = await db.query(
      `SELECT cf.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_folders cf
       LEFT JOIN users u ON u.id = cf.created_by
       WHERE cf.client_id = ?
       ORDER BY cf.name ASC`,
      [client.id]
    );
    client.folders = folders;

    // Fetch client notes
    const [notes] = await db.query(
      `SELECT cn.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_notes cn
       LEFT JOIN users u ON u.id = cn.created_by
       WHERE cn.client_id = ?
       ORDER BY cn.created_at DESC`,
      [client.id]
    );
    client.notes = notes;

    // Fetch DRS sections
    const [drs] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
       FROM client_drs d
       LEFT JOIN users u ON u.id = d.completed_by
       WHERE d.client_id = ?`,
      [client.id]
    );
    client.drs = {};
    for (const row of drs) {
      client.drs[row.section] = row;
    }

    return res.json(client);
  } catch (err) {
    console.error('Client getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING A
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/clients/:id/onboarding-a
 * Save or update Onboarding A data
 */
exports.saveOnboardingA = async (req, res) => {
  try {
    const clientId = req.params.id;
    const { company_name, client_name, designation, email, phone, full_address, gst_number, start_date, industry, completed } = req.body;

    // Check if record exists
    const [existing] = await db.query('SELECT id FROM client_onboarding_a WHERE client_id = ?', [clientId]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE client_onboarding_a SET
          company_name = ?, client_name = ?, designation = ?, email = ?, phone = ?,
          full_address = ?, gst_number = ?, start_date = ?, industry = ?, completed = ?
         WHERE client_id = ?`,
        [company_name, client_name, designation, email, phone, full_address, gst_number, start_date || null, industry, completed ? 1 : 0, clientId]
      );
    } else {
      await db.query(
        `INSERT INTO client_onboarding_a (client_id, company_name, client_name, designation, email, phone, full_address, gst_number, start_date, industry, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [clientId, company_name, client_name, designation, email, phone, full_address, gst_number, start_date || null, industry, completed ? 1 : 0]
      );
    }

    const [result] = await db.query('SELECT * FROM client_onboarding_a WHERE client_id = ?', [clientId]);
    return res.json(result[0]);
  } catch (err) {
    console.error('Save onboarding A error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING B
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/clients/:id/onboarding-b
 * Save or update Onboarding B data
 */
exports.saveOnboardingB = async (req, res) => {
  try {
    const clientId = req.params.id;
    const data = req.body;

    // Check if record exists
    const [existing] = await db.query('SELECT id FROM client_onboarding_b WHERE client_id = ?', [clientId]);

    const fields = {
      client_code: data.client_code || null,
      business_name: data.business_name || null,
      business_tagline: data.business_tagline || null,
      business_hours: data.business_hours || null,
      business_category: data.business_category || null,
      mode_of_business: data.mode_of_business || 'online',
      business_address: data.business_address || null,
      business_phone: data.business_phone || null,
      business_whatsapp: data.business_whatsapp || null,
      about_business: data.about_business || null,
      years_in_business: data.years_in_business || null,
      current_business_performance: data.current_business_performance || null,
      key_offers_usps: data.key_offers_usps || null,
      advertising_regulations: data.advertising_regulations || 'no',
      advertising_regulations_explain: data.advertising_regulations_explain || null,
      products_services: data.products_services ? JSON.stringify(data.products_services) : null,
      social_media_credentials: data.social_media_credentials || 'existing',
      digital_promotion_goals: data.digital_promotion_goals || null,
      previous_digital_marketing: data.previous_digital_marketing || 'no',
      previous_digital_marketing_report: data.previous_digital_marketing_report || null,
      brand_guidelines: data.brand_guidelines || null,
      logo_file_path: data.logo_file_path || null,
      photos_videos_paths: data.photos_videos_paths ? JSON.stringify(data.photos_videos_paths) : null,
      flyers_paths: data.flyers_paths ? JSON.stringify(data.flyers_paths) : null,
      brochures_paths: data.brochures_paths ? JSON.stringify(data.brochures_paths) : null,
      preferred_contact_mode: data.preferred_contact_mode || 'call',
      approval_contact_name: data.approval_contact_name || null,
      approval_contact_designation: data.approval_contact_designation || null,
      approval_contact_number: data.approval_contact_number || null,
      approval_contact_time: data.approval_contact_time || null,
      lead_followup_responsibility: data.lead_followup_responsibility || 'client',
      completed: data.completed ? 1 : 0,
    };

    if (existing.length > 0) {
      const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
      await db.query(
        `UPDATE client_onboarding_b SET ${setClauses} WHERE client_id = ?`,
        [...Object.values(fields), clientId]
      );
    } else {
      const cols = ['client_id', ...Object.keys(fields)].join(', ');
      const placeholders = ['?', ...Object.keys(fields).map(() => '?')].join(', ');
      await db.query(
        `INSERT INTO client_onboarding_b (${cols}) VALUES (${placeholders})`,
        [clientId, ...Object.values(fields)]
      );
    }

    const [result] = await db.query('SELECT * FROM client_onboarding_b WHERE client_id = ?', [clientId]);
    return res.json(result[0]);
  } catch (err) {
    console.error('Save onboarding B error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT NOTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/clients/:id/notes
 */
exports.addNote = async (req, res) => {
  try {
    const clientId = req.params.id;
    const { title, content } = req.body;

    if (!content) return res.status(400).json({ message: 'Content is required' });

    const [result] = await db.query(
      'INSERT INTO client_notes (client_id, title, content, created_by) VALUES (?, ?, ?, ?)',
      [clientId, title || null, content, req.user.id]
    );

    const [note] = await db.query(
      `SELECT cn.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_notes cn LEFT JOIN users u ON u.id = cn.created_by
       WHERE cn.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(note[0]);
  } catch (err) {
    console.error('Add note error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/clients/:id/notes/:noteId
 */
exports.deleteNote = async (req, res) => {
  try {
    await db.query('DELETE FROM client_notes WHERE id = ? AND client_id = ?', [req.params.noteId, req.params.id]);
    return res.json({ message: 'Note deleted' });
  } catch (err) {
    console.error('Delete note error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT FILES & FOLDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/clients/:id/folders
 * Get all folders for a client
 */
exports.getFolders = async (req, res) => {
  try {
    const [folders] = await db.query(
      `SELECT cf.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_folders cf
       LEFT JOIN users u ON u.id = cf.created_by
       WHERE cf.client_id = ?
       ORDER BY cf.name ASC`,
      [req.params.id]
    );
    return res.json(folders);
  } catch (err) {
    console.error('Get folders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/clients/:id/folders
 * Create a folder
 */
exports.createFolder = async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ message: 'Folder name is required' });

    const [result] = await db.query(
      'INSERT INTO client_folders (client_id, parent_id, name, created_by) VALUES (?, ?, ?, ?)',
      [req.params.id, parent_id || null, name, req.user.id]
    );

    const [folder] = await db.query('SELECT * FROM client_folders WHERE id = ?', [result.insertId]);
    return res.status(201).json(folder[0]);
  } catch (err) {
    console.error('Create folder error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/clients/:id/folders/:folderId
 */
exports.deleteFolder = async (req, res) => {
  try {
    await db.query('DELETE FROM client_folders WHERE id = ? AND client_id = ?', [req.params.folderId, req.params.id]);
    return res.json({ message: 'Folder deleted' });
  } catch (err) {
    console.error('Delete folder error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/clients/:id/files
 * Upload file(s) for a client
 */
exports.uploadFile = async (req, res) => {
  try {
    const clientId = req.params.id;
    const { category, folder_id } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploaded = [];
    for (const file of req.files) {
      const [result] = await db.query(
        'INSERT INTO client_files (client_id, folder_id, file_name, file_path, file_type, file_size, category, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [clientId, folder_id || null, file.originalname, file.path, file.mimetype, file.size, category || null, req.user.id]
      );
      uploaded.push({ id: result.insertId, file_name: file.originalname, file_path: file.path, file_type: file.mimetype, file_size: file.size, category, folder_id: folder_id || null });
    }

    return res.status(201).json(uploaded);
  } catch (err) {
    console.error('Upload file error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/clients/:id/files/:fileId/download
 * Force download a file
 */
exports.downloadFile = async (req, res) => {
  try {
    const [file] = await db.query('SELECT * FROM client_files WHERE id = ? AND client_id = ?', [req.params.fileId, req.params.id]);
    if (file.length === 0) return res.status(404).json({ message: 'File not found' });

    const filePath = file[0].file_path;
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' });

    res.download(filePath, file[0].file_name);
  } catch (err) {
    console.error('Download file error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/clients/:id/files/:fileId
 */
exports.deleteFile = async (req, res) => {
  try {
    const [file] = await db.query('SELECT * FROM client_files WHERE id = ? AND client_id = ?', [req.params.fileId, req.params.id]);
    if (file.length > 0) {
      // Try to delete physical file
      try { fs.unlinkSync(file[0].file_path); } catch (e) { /* ignore */ }
      await db.query('DELETE FROM client_files WHERE id = ?', [req.params.fileId]);
    }
    return res.json({ message: 'File deleted' });
  } catch (err) {
    console.error('Delete file error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT DRS (Discovery & Research Sheet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/clients/:id/drs/:section
 * Save or update a DRS section
 */
exports.saveDrs = async (req, res) => {
  try {
    const clientId = req.params.id;
    const section = req.params.section;
    const { data, completed } = req.body;

    const validSections = ['account_manager', 'content_writer', 'graphic_designer', 'video_editor', 'videographer', 'ads_manager'];
    if (!validSections.includes(section)) {
      return res.status(400).json({ message: 'Invalid DRS section' });
    }

    const jsonData = JSON.stringify(data || {});
    const [existing] = await db.query('SELECT id FROM client_drs WHERE client_id = ? AND section = ?', [clientId, section]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE client_drs SET data = ?, completed = ?, completed_by = ?, completed_at = ? WHERE client_id = ? AND section = ?`,
        [jsonData, completed ? 1 : 0, completed ? req.user.id : null, completed ? new Date() : null, clientId, section]
      );
    } else {
      await db.query(
        `INSERT INTO client_drs (client_id, section, data, completed, completed_by, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [clientId, section, jsonData, completed ? 1 : 0, completed ? req.user.id : null, completed ? new Date() : null]
      );
    }

    const [result] = await db.query('SELECT * FROM client_drs WHERE client_id = ? AND section = ?', [clientId, section]);
    return res.json(result[0]);
  } catch (err) {
    console.error('Save DRS error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT RECENT ACTIVITY (aggregated timeline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/clients/:id/activity
 * Returns recent activity across all modules for this client
 */
exports.getActivity = async (req, res) => {
  try {
    const clientId = req.params.id;
    const limit = parseInt(req.query.limit) || 30;
    const activities = [];

    // Follow-ups
    const [followUps] = await db.query(
      `SELECT f.id, f.note AS description, f.type, f.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = ?
       ORDER BY f.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    followUps.forEach(r => activities.push({
      type: 'follow_up', icon: '📞', color: 'blue',
      title: `Follow-up logged — ${r.type || 'Note'}`,
      description: r.description, user: r.user_name, date: r.created_at
    }));

    // Tasks created for client's projects
    const [tasks] = await db.query(
      `SELECT t.id, t.title, t.created_at, t.status,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM tasks t
       INNER JOIN project_tasks pt ON pt.task_id = t.id
       INNER JOIN projects p ON p.id = pt.project_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE p.client_id = ? AND t.deleted = 0
       ORDER BY t.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    tasks.forEach(r => activities.push({
      type: 'task', icon: '📋', color: 'yellow',
      title: `Task created — ${r.title}`,
      description: `Status: ${r.status}`, user: r.user_name, date: r.created_at
    }));

    // Tickets
    const [tickets] = await db.query(
      `SELECT tk.id, tk.title, tk.status, tk.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.reported_by
       WHERE tk.related_to_type = 'client' AND tk.related_to_id = ? AND tk.deleted = 0
       ORDER BY tk.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    tickets.forEach(r => activities.push({
      type: 'ticket', icon: '🎫', color: 'purple',
      title: `Ticket — ${r.title}`,
      description: `Status: ${r.status}`, user: r.user_name, date: r.created_at
    }));

    // Shoots
    const [shoots] = await db.query(
      `SELECT s.id, s.project_campaign_name, s.status, s.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM shoots s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.client_brand_id = ? AND s.deleted = 0
       ORDER BY s.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    shoots.forEach(r => activities.push({
      type: 'shoot', icon: '📸', color: 'pink',
      title: `Shoot — ${r.project_campaign_name}`,
      description: `Status: ${r.status?.replace(/_/g, ' ')}`, user: r.user_name, date: r.created_at
    }));

    // Invoices
    const [invoices] = await db.query(
      `SELECT i.id, i.invoice_number, i.status, i.total_amount, i.created_at
       FROM invoices i
       WHERE i.lead_id = ? AND i.deleted = 0
       ORDER BY i.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    invoices.forEach(r => activities.push({
      type: 'invoice', icon: '💰', color: 'green',
      title: `Invoice ${r.invoice_number} — ₹${Number(r.total_amount).toLocaleString()}`,
      description: `Status: ${r.status}`, user: null, date: r.created_at
    }));

    // Expenses
    const [expenses] = await db.query(
      `SELECT e.id, e.title, e.amount, e.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.client_id = ? AND e.deleted = 0
       ORDER BY e.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    expenses.forEach(r => activities.push({
      type: 'expense', icon: '💸', color: 'red',
      title: `Expense — ${r.title} (₹${Number(r.amount).toLocaleString()})`,
      description: null, user: r.user_name, date: r.created_at
    }));

    // Files uploaded
    const [files] = await db.query(
      `SELECT cf.id, cf.file_name, cf.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM client_files cf
       LEFT JOIN users u ON u.id = cf.uploaded_by
       WHERE cf.client_id = ?
       ORDER BY cf.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    files.forEach(r => activities.push({
      type: 'file', icon: '📁', color: 'indigo',
      title: `File uploaded — ${r.file_name}`,
      description: null, user: r.user_name, date: r.created_at
    }));

    // Notes
    const [notes] = await db.query(
      `SELECT cn.id, cn.title, cn.content, cn.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM client_notes cn
       LEFT JOIN users u ON u.id = cn.created_by
       WHERE cn.client_id = ?
       ORDER BY cn.created_at DESC LIMIT ?`,
      [clientId, limit]
    );
    notes.forEach(r => activities.push({
      type: 'note', icon: '📝', color: 'amber',
      title: `Note added${r.title ? ' — ' + r.title : ''}`,
      description: r.content?.substring(0, 100), user: r.user_name, date: r.created_at
    }));

    // DRS sections completed
    const [drs] = await db.query(
      `SELECT d.section, d.completed_at AS created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM client_drs d
       LEFT JOIN users u ON u.id = d.completed_by
       WHERE d.client_id = ? AND d.completed = 1`,
      [clientId]
    );
    drs.forEach(r => activities.push({
      type: 'drs', icon: '✅', color: 'green',
      title: `DRS completed — ${r.section?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
      description: null, user: r.user_name, date: r.created_at
    }));

    // Sort all by date descending and limit
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json(activities.slice(0, limit));
  } catch (err) {
    console.error('Client activity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
