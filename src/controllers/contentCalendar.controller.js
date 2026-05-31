const { validationResult } = require('express-validator');
const db = require('../config/db');

const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;
const toInt = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

// ─── Generate next global Ad No (e.g. AD-001, AD-002 ...) ────────────────────
// Queries the MAX numeric suffix across ALL ads in the table so every ad
// across every plan and every user gets a unique sequential number.
async function generateNextAdNo(conn) {
  const [rows] = await conn.query(
    `SELECT ad_no FROM content_calendar_ads WHERE ad_no REGEXP '^AD-[0-9]+$' ORDER BY CAST(SUBSTRING(ad_no, 4) AS UNSIGNED) DESC LIMIT 1`
  );
  let next = 1;
  if (rows.length > 0) {
    const last = parseInt(rows[0].ad_no.replace('AD-', ''), 10);
    if (!isNaN(last)) next = last + 1;
  }
  return `AD-${String(next).padStart(3, '0')}`;
}

// ─── LIST PLANS ───────────────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const { client_id, month, status } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (client_id) { where += ' AND p.client_id = ?'; params.push(client_id); }
    if (month) { where += ' AND p.plan_month = ?'; params.push(month); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }

    if (!req.user.is_admin) {
      where += ' AND p.created_by = ?';
      params.push(req.user.id);
    }

    let rows = [];
    try {
      const [result] = await db.query(
        `SELECT p.*,
                l.business_name AS client_name,
                CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
                (SELECT COUNT(*) FROM content_calendar_posts WHERE plan_id = p.id) AS post_count,
                (SELECT COUNT(*) FROM content_calendar_shoots WHERE plan_id = p.id) AS shoot_count,
                (SELECT COUNT(*) FROM content_calendar_ads WHERE plan_id = p.id) AS ad_count
         FROM content_calendar_plans p
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN users u ON u.id = p.created_by
         WHERE ${where}
         ORDER BY p.plan_month DESC, p.created_at DESC`,
        params
      );
      rows = result;
    } catch (tableErr) {
      if (tableErr.code === 'ER_NO_SUCH_TABLE') {
        return res.json({ plans: [] });
      }
      throw tableErr;
    }

    return res.json({ plans: rows });
  } catch (err) {
    console.error('Content calendar list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET SINGLE PLAN WITH ALL CHILDREN ────────────────────────────────────────

exports.getOne = async (req, res) => {
  try {
    const [plans] = await db.query(
      `SELECT p.*,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM content_calendar_plans p
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );

    if (plans.length === 0) return res.status(404).json({ message: 'Plan not found' });

    const plan = plans[0];

    if (!req.user.is_admin && plan.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch children
    const [posts] = await db.query(
      `SELECT cp.*,
              cwr.hook_opening_line AS brief_hook, cwr.content_id_code AS brief_code,
              cwr.content_type AS brief_content_type, cwr.platform AS brief_platform,
              cwr.call_to_action AS brief_cta
       FROM content_calendar_posts cp
       LEFT JOIN content_write_requests cwr ON cwr.id = cp.linked_brief_id
       WHERE cp.plan_id = ?
       ORDER BY cp.id ASC`,
      [plan.id]
    );

    const [shoots] = await db.query(
      `SELECT cs.*,
              s.shoot_id_code AS linked_shoot_code, s.project_campaign_name AS shoot_name,
              s.shoot_date AS linked_shoot_date, s.city AS shoot_city, s.location_type AS shoot_location_type
       FROM content_calendar_shoots cs
       LEFT JOIN shoots s ON s.id = cs.linked_shoot_id
       WHERE cs.plan_id = ?
       ORDER BY cs.id ASC`,
      [plan.id]
    );

    const [ads] = await db.query(
      `SELECT * FROM content_calendar_ads WHERE plan_id = ? ORDER BY start_date ASC`,
      [plan.id]
    );

    return res.json({ ...plan, posts, shoots, ads });
  } catch (err) {
    console.error('Content calendar getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE PLAN ──────────────────────────────────────────────────────────────

exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { client_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, posts, shoots, ads } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Check for duplicate client+month
    const [existing] = await conn.query(
      'SELECT id FROM content_calendar_plans WHERE client_id = ? AND plan_month = ? AND deleted = 0',
      [client_id, plan_month]
    );
    if (existing.length > 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'A plan already exists for this client and month' });
    }

    const [result] = await conn.query(
      `INSERT INTO content_calendar_plans 
        (client_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [client_id, plan_month, toNull(primary_goal), toNull(target_audience), toNull(budget_allocation), toNull(hero_offer), req.user.id]
    );

    const planId = result.insertId;

    // Insert posts
    if (posts && posts.length > 0) {
      for (const post of posts) {
        await conn.query(
          `INSERT INTO content_calendar_posts 
            (plan_id, linked_brief_id, post_no, platform, format, topic, ad_target, shoot_date, posting_date, cta, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [planId, toInt(post.linked_brief_id), toNull(post.post_no), toNull(post.platform),
           toNull(post.format), toNull(post.topic), post.ad_target || 'organic',
           toNull(post.shoot_date), toNull(post.posting_date), toNull(post.cta), post.status || 'planned']
        );
      }
    }

    // Insert shoots
    if (shoots && shoots.length > 0) {
      for (const shoot of shoots) {
        await conn.query(
          `INSERT INTO content_calendar_shoots 
            (plan_id, linked_shoot_id, shoot_date, location, description, num_videos, num_photos, talent, production_notes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [planId, toInt(shoot.linked_shoot_id), toNull(shoot.shoot_date), toNull(shoot.location),
           toNull(shoot.description), shoot.num_videos || 0, shoot.num_photos || 0,
           toNull(shoot.talent), toNull(shoot.production_notes), shoot.status || 'planned']
        );
      }
    }

    // Insert ads — generate ad_no sequentially from global max
    if (ads && ads.length > 0) {
      for (const ad of ads) {
        const adNo = await generateNextAdNo(conn);
        await conn.query(
          `INSERT INTO content_calendar_ads 
            (plan_id, ad_no, creative_name, campaign_objective, platform, ad_status, target_audience, budget, start_date, end_date, expected_outcomes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [planId, adNo, toNull(ad.creative_name), ad.campaign_objective, toNull(ad.platform),
           ad.ad_status || 'planned', toNull(ad.target_audience), toNull(ad.budget), ad.start_date, toNull(ad.end_date), toNull(ad.expected_outcomes)]
        );
      }
    }

    await conn.commit();

    // Fetch full plan
    const [plans] = await conn.query(
      `SELECT p.*, l.business_name AS client_name
       FROM content_calendar_plans p
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE p.id = ?`,
      [planId]
    );

    conn.release();
    res.emitSocket('content-calendar:created', plans[0]);
    return res.status(201).json(plans[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Content calendar create error:', err.message, err.sql || '');
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};

// ─── UPDATE PLAN ──────────────────────────────────────────────────────────────

exports.update = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [plans] = await conn.query('SELECT * FROM content_calendar_plans WHERE id = ? AND deleted = 0', [req.params.id]);
    if (plans.length === 0) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ message: 'Plan not found' });
    }

    const plan = plans[0];
    if (!req.user.is_admin && plan.created_by !== req.user.id) {
      await conn.rollback(); conn.release();
      return res.status(403).json({ message: 'Access denied' });
    }

    const { client_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, status, posts, shoots, ads } = req.body;

    // Update plan fields
    const planUpdates = {};
    if (client_id !== undefined) planUpdates.client_id = client_id;
    if (plan_month !== undefined) planUpdates.plan_month = plan_month;
    if (primary_goal !== undefined) planUpdates.primary_goal = toNull(primary_goal);
    if (target_audience !== undefined) planUpdates.target_audience = toNull(target_audience);
    if (budget_allocation !== undefined) planUpdates.budget_allocation = toNull(budget_allocation);
    if (hero_offer !== undefined) planUpdates.hero_offer = toNull(hero_offer);
    if (status !== undefined) planUpdates.status = status;

    if (Object.keys(planUpdates).length > 0) {
      const setClauses = Object.keys(planUpdates).map(k => `${k} = ?`).join(', ');
      await conn.query(`UPDATE content_calendar_plans SET ${setClauses} WHERE id = ?`, [...Object.values(planUpdates), req.params.id]);
    }

    // Replace posts (delete all + re-insert)
    if (posts !== undefined) {
      await conn.query('DELETE FROM content_calendar_posts WHERE plan_id = ?', [req.params.id]);
      if (posts.length > 0) {
        for (const post of posts) {
          await conn.query(
            `INSERT INTO content_calendar_posts 
              (plan_id, linked_brief_id, post_no, platform, format, topic, ad_target, shoot_date, posting_date, cta, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, toInt(post.linked_brief_id), toNull(post.post_no), toNull(post.platform),
             toNull(post.format), toNull(post.topic), post.ad_target || 'organic',
             toNull(post.shoot_date), toNull(post.posting_date), toNull(post.cta), post.status || 'planned']
          );
        }
      }
    }

    // Replace shoots
    if (shoots !== undefined) {
      await conn.query('DELETE FROM content_calendar_shoots WHERE plan_id = ?', [req.params.id]);
      if (shoots.length > 0) {
        for (const shoot of shoots) {
          await conn.query(
            `INSERT INTO content_calendar_shoots 
              (plan_id, linked_shoot_id, shoot_date, location, description, num_videos, num_photos, talent, production_notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, toInt(shoot.linked_shoot_id), toNull(shoot.shoot_date), toNull(shoot.location),
             toNull(shoot.description), shoot.num_videos || 0, shoot.num_photos || 0,
             toNull(shoot.talent), toNull(shoot.production_notes), shoot.status || 'planned']
          );
        }
      }
    }

    // Replace ads — preserve existing ad_no if already set, generate new ones for new ads
    if (ads !== undefined) {
      // Fetch existing ads to preserve their ad_no values
      const [existingAds] = await conn.query(
        'SELECT id, ad_no FROM content_calendar_ads WHERE plan_id = ? ORDER BY id ASC',
        [req.params.id]
      );
      await conn.query('DELETE FROM content_calendar_ads WHERE plan_id = ?', [req.params.id]);
      if (ads.length > 0) {
        for (let i = 0; i < ads.length; i++) {
          const ad = ads[i];
          // Reuse existing ad_no if available, otherwise generate a new global one
          let adNo = (existingAds[i] && existingAds[i].ad_no) ? existingAds[i].ad_no : await generateNextAdNo(conn);
          await conn.query(
            `INSERT INTO content_calendar_ads 
              (plan_id, ad_no, creative_name, campaign_objective, platform, ad_status, target_audience, budget, start_date, end_date, expected_outcomes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, adNo, toNull(ad.creative_name), ad.campaign_objective, toNull(ad.platform),
             ad.ad_status || 'planned', toNull(ad.target_audience), toNull(ad.budget), ad.start_date, toNull(ad.end_date), toNull(ad.expected_outcomes)]
          );
        }
      }
    }

    await conn.commit();

    // Fetch updated plan
    const [updated] = await conn.query(
      `SELECT p.*, l.business_name AS client_name
       FROM content_calendar_plans p
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE p.id = ?`,
      [req.params.id]
    );

    conn.release();
    res.emitSocket('content-calendar:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Content calendar update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE PLAN ──────────────────────────────────────────────────────────────

exports.remove = async (req, res) => {
  try {
    const [plans] = await db.query('SELECT * FROM content_calendar_plans WHERE id = ? AND deleted = 0', [req.params.id]);
    if (plans.length === 0) return res.status(404).json({ message: 'Plan not found' });

    if (!req.user.is_admin && plans[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can delete' });
    }

    await db.query('UPDATE content_calendar_plans SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('content-calendar:deleted', { id: req.params.id });
    return res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('Content calendar delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CALENDAR VIEW DATA ───────────────────────────────────────────────────────
// Returns all posts, shoots, and ads for a given month (across all clients or filtered)

exports.calendarView = async (req, res) => {
  try {
    const { month, client_id } = req.query; // month = '2026-05-01'
    if (!month) return res.status(400).json({ message: 'Month parameter is required' });

    // Calculate month range
    const startDate = month; // first day
    const endDateObj = new Date(month);
    endDateObj.setMonth(endDateObj.getMonth() + 1);
    endDateObj.setDate(0); // last day of month
    const endDate = endDateObj.toISOString().split('T')[0];

    let planWhere = 'p.deleted = 0 AND p.plan_month = ?';
    const planParams = [month];

    if (client_id) { planWhere += ' AND p.client_id = ?'; planParams.push(client_id); }
    if (!req.user.is_admin) { planWhere += ' AND p.created_by = ?'; planParams.push(req.user.id); }

    // Get plan IDs for this month
    let plans = [];
    try {
      const [rows] = await db.query(
        `SELECT p.id, p.client_id, l.business_name AS client_name
         FROM content_calendar_plans p
         LEFT JOIN leads l ON l.id = p.client_id
         WHERE ${planWhere}`,
        planParams
      );
      plans = rows;
    } catch (tableErr) {
      // Table might not exist yet
      if (tableErr.code === 'ER_NO_SUCH_TABLE') {
        return res.json({ posts: [], shoots: [], ads: [], plans: [] });
      }
      throw tableErr;
    }

    if (plans.length === 0) {
      return res.json({ posts: [], shoots: [], ads: [], plans: [] });
    }

    const planIds = plans.map(p => p.id);

    // Fetch posts for these plans within the month
    const [posts] = await db.query(
      `SELECT cp.*, p.client_id, l.business_name AS client_name,
              cwr.hook_opening_line AS brief_hook, cwr.content_id_code AS brief_code,
              cwr.content_type AS brief_content_type, cwr.platform AS brief_platform
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN content_write_requests cwr ON cwr.id = cp.linked_brief_id
       WHERE cp.plan_id IN (?)
       ORDER BY cp.id ASC`,
      [planIds]
    );

    // Fetch shoots for these plans within the month
    const [shoots] = await db.query(
      `SELECT cs.*, p.client_id, l.business_name AS client_name,
              s.shoot_id_code AS linked_shoot_code, s.project_campaign_name AS shoot_name,
              s.shoot_date AS linked_shoot_date, s.city AS shoot_city
       FROM content_calendar_shoots cs
       JOIN content_calendar_plans p ON p.id = cs.plan_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN shoots s ON s.id = cs.linked_shoot_id
       WHERE cs.plan_id IN (?)
       ORDER BY cs.id ASC`,
      [planIds]
    );

    // Fetch ads for these plans that overlap with the month
    const [ads] = await db.query(
      `SELECT ca.*, p.client_id, l.business_name AS client_name
       FROM content_calendar_ads ca
       JOIN content_calendar_plans p ON p.id = ca.plan_id
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE ca.plan_id IN (?)
       ORDER BY ca.start_date ASC`,
      [planIds]
    );

    return res.json({ posts, shoots, ads, plans });
  } catch (err) {
    console.error('Content calendar view error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── APPROVED BRIEFS (for linking dropdown) ───────────────────────────────────

exports.approvedBriefs = async (req, res) => {
  try {
    const { client_id } = req.query;
    let where = "cwr.status = 'approved' AND cwr.deleted = 0";
    const params = [];

    if (client_id) { where += ' AND cwr.client_brand_id = ?'; params.push(client_id); }

    const [rows] = await db.query(
      `SELECT cwr.id, cwr.content_id_code, cwr.hook_opening_line, cwr.content_type, cwr.call_to_action, cwr.platform,
              l.business_name AS client_brand_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       WHERE ${where}
       ORDER BY cwr.created_at DESC`,
      params
    );

    return res.json({ briefs: rows });
  } catch (err) {
    console.error('Approved briefs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── APPROVED SHOOTS (for linking dropdown) ───────────────────────────────────

exports.approvedShoots = async (req, res) => {
  try {
    const { client_id } = req.query;
    let where = "s.status IN ('approved','pending_completion','completed') AND s.deleted = 0";
    const params = [];

    if (client_id) { where += ' AND s.client_brand_id = ?'; params.push(client_id); }

    const [rows] = await db.query(
      `SELECT s.id, s.shoot_id_code, s.project_campaign_name, s.shoot_date, s.city, s.location_type,
              l.business_name AS client_brand_name
       FROM shoots s
       LEFT JOIN leads l ON l.id = s.client_brand_id
       WHERE ${where}
       ORDER BY s.shoot_date DESC`,
      params
    );

    return res.json({ shoots: rows });
  } catch (err) {
    console.error('Approved shoots error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
