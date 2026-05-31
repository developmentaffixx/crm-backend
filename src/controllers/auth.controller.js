const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const db = require('../config/db');

/**
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { login_id, password } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE emp_code = ? AND deleted = 0 AND is_active = 1',
      [login_id.toUpperCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid Login ID or password' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid Login ID or password' });
    }

    // Fetch role name if user has a role
    let roleName = null;
    if (user.role_id) {
      const [roleRows] = await db.query('SELECT name FROM roles WHERE id = ?', [user.role_id]);
      roleName = roleRows[0]?.name || null;
    }

    const payload = {
      id:       user.id,
      email:    user.email,
      is_admin: user.is_admin === 1,
      first_name: user.first_name,
      last_name:  user.last_name,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    // Track last login timestamp
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    return res.json({
      token,
      user: {
        id:         user.id,
        first_name: user.first_name,
        last_name:  user.last_name,
        email:      user.email,
        is_admin:   user.is_admin === 1,
        role_id:    user.role_id,
        role_name:  roleName,
        avatar_url: user.avatar_url || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/auth/register
 */
exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { first_name, last_name, email, password, is_admin = 0 } = req.body;

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (first_name, last_name, email, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)',
      [first_name, last_name, email, hash, is_admin ? 1 : 0]
    );

    // Generate emp_code: DOUBT for admin, AFID#### for team members
    let emp_code;
    if (is_admin) {
      emp_code = 'DOUBT';
    } else {
      const [codeRows] = await db.query(
        `SELECT emp_code FROM users WHERE emp_code LIKE 'AFID%' AND deleted = 0`
      );
      const usedNumbers = codeRows
        .map(r => parseInt(r.emp_code.replace('AFID', ''), 10))
        .filter(n => !isNaN(n));
      let next = 1;
      while (usedNumbers.includes(next)) next++;
      emp_code = `AFID${String(next).padStart(4, '0')}`;
    }
    await db.query('UPDATE users SET emp_code = ? WHERE id = ?', [emp_code, result.insertId]);

    return res.status(201).json({ message: 'User created', id: result.insertId });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
