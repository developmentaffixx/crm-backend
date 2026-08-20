const db = require('../config/db');

// Valid access types
const VALID_ACCESS_TYPES = ['all', 'roles', 'users', 'roles_and_users'];

// Helper to parse JSON fields safely
function parseRow(row) {
  let sections = [];
  let allowed_roles = [];
  let allowed_users = [];

  try {
    sections = row.sections
      ? (typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections)
      : [];
  } catch (e) { sections = []; }

  try {
    allowed_roles = row.allowed_roles
      ? (typeof row.allowed_roles === 'string' ? JSON.parse(row.allowed_roles) : row.allowed_roles)
      : [];
  } catch (e) { allowed_roles = []; }

  try {
    allowed_users = row.allowed_users
      ? (typeof row.allowed_users === 'string' ? JSON.parse(row.allowed_users) : row.allowed_users)
      : [];
  } catch (e) { allowed_users = []; }

  return { ...row, sections, allowed_roles, allowed_users };
}

// Helper: check if a user has access to a document based on permissions
function userHasAccess(doc, userId, userRoleId) {
  const accessType = doc.access_type || 'all';

  if (accessType === 'all') return true;

  if (accessType === 'roles') {
    return Array.isArray(doc.allowed_roles) && doc.allowed_roles.includes(userRoleId);
  }

  if (accessType === 'users') {
    return Array.isArray(doc.allowed_users) && doc.allowed_users.includes(userId);
  }

  if (accessType === 'roles_and_users') {
    const roleMatch = Array.isArray(doc.allowed_roles) && doc.allowed_roles.includes(userRoleId);
    const userMatch = Array.isArray(doc.allowed_users) && doc.allowed_users.includes(userId);
    return roleMatch || userMatch;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST all documents (admin settings view — no permission filtering)
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM intro_documents d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.is_active = 1
       ORDER BY d.sort_order, d.created_at DESC`
    );

    return res.json(rows.map(parseRow));
  } catch (err) {
    console.error('IntroDocuments list error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LIST visible documents (permission-filtered for current user)
// ─────────────────────────────────────────────────────────────────────────────
exports.listVisible = async (req, res) => {
  try {
    const userId = req.user.id;
    // Fetch role_id from DB
    const [userRows] = await db.query('SELECT role_id FROM users WHERE id = ?', [userId]);
    const userRoleId = userRows[0]?.role_id || null;

    const [rows] = await db.query(
      `SELECT id, title, sections, access_type, allowed_roles, allowed_users
       FROM intro_documents
       WHERE is_active = 1
       ORDER BY sort_order, created_at DESC`
    );

    // Filter by user access
    const results = [];
    for (const row of rows) {
      const parsed = parseRow(row);
      if (userHasAccess(parsed, userId, userRoleId)) {
        results.push({
          id: parsed.id,
          title: parsed.title,
          sections: parsed.sections,
        });
      }
    }

    return res.json(results);
  } catch (err) {
    console.error('IntroDocuments listVisible error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single document
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM intro_documents WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    return res.json(parseRow(rows[0]));
  } catch (err) {
    console.error('IntroDocuments getOne error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const { title, sections, sort_order, access_type, allowed_roles, allowed_users } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }
  if (!sections || !Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ message: 'At least one section is required' });
  }
  for (const section of sections) {
    if (!section.title || !section.title.trim()) {
      return res.status(400).json({ message: 'Each section must have a title' });
    }
  }

  // Validate access_type
  const finalAccessType = access_type && VALID_ACCESS_TYPES.includes(access_type) ? access_type : 'all';

  // Validate allowed_roles/allowed_users based on access_type
  if ((finalAccessType === 'roles' || finalAccessType === 'roles_and_users') && (!allowed_roles || !Array.isArray(allowed_roles) || allowed_roles.length === 0)) {
    return res.status(400).json({ message: 'At least one role must be selected' });
  }
  if ((finalAccessType === 'users' || finalAccessType === 'roles_and_users') && (!allowed_users || !Array.isArray(allowed_users) || allowed_users.length === 0)) {
    return res.status(400).json({ message: 'At least one user must be selected' });
  }

  try {
    const sectionsJson = JSON.stringify(sections.map((s, idx) => {
      let description = (s.description || '').trim();
      // Decode base64-encoded descriptions from frontend (avoids WAF blocking HTML)
      if (s.encoded && description) {
        try {
          description = Buffer.from(description, 'base64').toString('utf8');
        } catch (e) { /* use as-is if decode fails */ }
      }
      return { title: s.title.trim(), description, order: idx };
    }));

    const allowedRolesJson = (finalAccessType === 'roles' || finalAccessType === 'roles_and_users')
      ? JSON.stringify(allowed_roles.map(Number))
      : null;
    const allowedUsersJson = (finalAccessType === 'users' || finalAccessType === 'roles_and_users')
      ? JSON.stringify(allowed_users.map(Number))
      : null;

    const [result] = await db.query(
      `INSERT INTO intro_documents (title, sections, access_type, allowed_roles, allowed_users, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), sectionsJson, finalAccessType, allowedRolesJson, allowedUsersJson, sort_order || 0, req.user.id]
    );

    const [created] = await db.query('SELECT * FROM intro_documents WHERE id = ?', [result.insertId]);
    return res.status(201).json(parseRow(created[0]));
  } catch (err) {
    console.error('IntroDocuments create error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM intro_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const { title, sections, sort_order, access_type, allowed_roles, allowed_users } = req.body;
    const current = parseRow(rows[0]);

    // Validate sections if provided
    if (sections && Array.isArray(sections)) {
      for (const section of sections) {
        if (!section.title || !section.title.trim()) {
          return res.status(400).json({ message: 'Each section must have a title' });
        }
      }
    }

    // Determine final access_type
    const finalAccessType = access_type && VALID_ACCESS_TYPES.includes(access_type) ? access_type : (current.access_type || 'all');

    // Validate allowed_roles/allowed_users based on access_type
    const finalAllowedRoles = allowed_roles !== undefined ? allowed_roles : current.allowed_roles;
    const finalAllowedUsers = allowed_users !== undefined ? allowed_users : current.allowed_users;

    if ((finalAccessType === 'roles' || finalAccessType === 'roles_and_users') && (!finalAllowedRoles || !Array.isArray(finalAllowedRoles) || finalAllowedRoles.length === 0)) {
      return res.status(400).json({ message: 'At least one role must be selected' });
    }
    if ((finalAccessType === 'users' || finalAccessType === 'roles_and_users') && (!finalAllowedUsers || !Array.isArray(finalAllowedUsers) || finalAllowedUsers.length === 0)) {
      return res.status(400).json({ message: 'At least one user must be selected' });
    }

    const newSections = sections
      ? JSON.stringify(sections.map((s, idx) => {
          let description = (s.description || '').trim();
          if (s.encoded && description) {
            try {
              description = Buffer.from(description, 'base64').toString('utf8');
            } catch (e) { /* use as-is */ }
          }
          return { title: s.title.trim(), description, order: idx };
        }))
      : JSON.stringify(current.sections);

    const allowedRolesJson = (finalAccessType === 'roles' || finalAccessType === 'roles_and_users')
      ? JSON.stringify((allowed_roles !== undefined ? allowed_roles : current.allowed_roles || []).map(Number))
      : null;
    const allowedUsersJson = (finalAccessType === 'users' || finalAccessType === 'roles_and_users')
      ? JSON.stringify((allowed_users !== undefined ? allowed_users : current.allowed_users || []).map(Number))
      : null;

    await db.query(
      `UPDATE intro_documents SET
        title = ?, sections = ?, access_type = ?, allowed_roles = ?, allowed_users = ?, sort_order = ?
       WHERE id = ?`,
      [
        title !== undefined ? title.trim() : current.title,
        newSections,
        finalAccessType,
        allowedRolesJson,
        allowedUsersJson,
        sort_order !== undefined ? sort_order : current.sort_order,
        req.params.id,
      ]
    );

    const [updated] = await db.query('SELECT * FROM intro_documents WHERE id = ?', [req.params.id]);
    return res.json(parseRow(updated[0]));
  } catch (err) {
    console.error('IntroDocuments update error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (soft) document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM intro_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    await db.query('UPDATE intro_documents SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error('IntroDocuments remove error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};
