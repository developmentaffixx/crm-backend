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
    const { client_id, month, status, project_id, cycle_id, page = 1, limit = 50 } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (client_id) { where += ' AND p.client_id = ?'; params.push(client_id); }
    if (project_id) { where += ' AND p.project_id = ?'; params.push(project_id); }
    if (cycle_id) { where += ' AND p.cycle_id = ?'; params.push(cycle_id); }
    if (month) { where += ' AND p.plan_month = ?'; params.push(month); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }

    if (!req.user.is_admin) {
      where += ` AND (p.created_by = ? OR p.id IN (
        SELECT plan_id FROM content_calendar_posts WHERE assigned_to = ?
        UNION SELECT plan_id FROM content_calendar_shoots WHERE assigned_to = ?
        UNION SELECT plan_id FROM content_calendar_ads WHERE assigned_to = ?
      ))`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let rows = [];
    try {
      const [result] = await db.query(
        `SELECT p.*,
                l.business_name AS client_name,
                pr.title AS project_title,
                CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
                (SELECT COUNT(*) FROM content_calendar_posts WHERE plan_id = p.id) AS post_count,
                (SELECT COUNT(*) FROM content_calendar_shoots WHERE plan_id = p.id) AS shoot_count,
                (SELECT COUNT(*) FROM content_calendar_ads WHERE plan_id = p.id) AS ad_count
         FROM content_calendar_plans p
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN projects pr ON pr.id = p.project_id
         LEFT JOIN users u ON u.id = p.created_by
         WHERE ${where}
         ORDER BY p.plan_month DESC, p.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      );
      rows = result;
    } catch (tableErr) {
      if (tableErr.code === 'ER_NO_SUCH_TABLE') {
        return res.json({ plans: [], total: 0 });
      }
      // Fallback if assigned_to column doesn't exist yet
      if (tableErr.code === 'ER_BAD_FIELD_ERROR' && !req.user.is_admin) {
        // Rebuild with simple created_by filter
        let fbWhere = 'p.deleted = 0';
        const fbParams = [];
        if (client_id) { fbWhere += ' AND p.client_id = ?'; fbParams.push(client_id); }
        if (project_id) { fbWhere += ' AND p.project_id = ?'; fbParams.push(project_id); }
        if (cycle_id) { fbWhere += ' AND p.cycle_id = ?'; fbParams.push(cycle_id); }
        if (month) { fbWhere += ' AND p.plan_month = ?'; fbParams.push(month); }
        if (status) { fbWhere += ' AND p.status = ?'; fbParams.push(status); }
        fbWhere += ' AND p.created_by = ?'; fbParams.push(req.user.id);
        const [result] = await db.query(
          `SELECT p.*, l.business_name AS client_name, pr.title AS project_title,
                  CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
                  (SELECT COUNT(*) FROM content_calendar_posts WHERE plan_id = p.id) AS post_count,
                  (SELECT COUNT(*) FROM content_calendar_shoots WHERE plan_id = p.id) AS shoot_count,
                  (SELECT COUNT(*) FROM content_calendar_ads WHERE plan_id = p.id) AS ad_count
           FROM content_calendar_plans p LEFT JOIN leads l ON l.id = p.client_id
           LEFT JOIN projects pr ON pr.id = p.project_id LEFT JOIN users u ON u.id = p.created_by
           WHERE ${fbWhere} ORDER BY p.plan_month DESC, p.created_at DESC LIMIT ? OFFSET ?`,
          [...fbParams, parseInt(limit), offset]
        );
        rows = result;
      } else throw tableErr;
    }

    // Get total count for pagination
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM content_calendar_plans p WHERE ${where}`,
      params
    );

    return res.json({ plans: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
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
              pr.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM content_calendar_plans p
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN projects pr ON pr.id = p.project_id
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
      `SELECT ca.*, ac.campaign_name AS linked_campaign_name, ac.status AS linked_campaign_status
       FROM content_calendar_ads ca
       LEFT JOIN ad_campaigns ac ON ac.id = ca.linked_campaign_id
       WHERE ca.plan_id = ? ORDER BY ca.start_date ASC`,
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

  const { client_id, project_id, cycle_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, posts, shoots, ads } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Resolve client_id from project if project_id is provided
    let resolvedClientId = client_id || null;
    if (project_id && !resolvedClientId) {
      const [proj] = await conn.query('SELECT client_id FROM projects WHERE id = ?', [project_id]);
      if (proj.length > 0) resolvedClientId = proj[0].client_id;
    }

    // Check for duplicate project+cycle — reuse existing plan if found
    let planId = null;

    if (cycle_id) {
      const [existing] = await conn.query(
        'SELECT id FROM content_calendar_plans WHERE cycle_id = ? AND deleted = 0',
        [cycle_id]
      );
      if (existing.length > 0) {
        planId = existing[0].id;
      }
    } else {
      // Legacy: check for duplicate project+month
      const [existing] = await conn.query(
        'SELECT id FROM content_calendar_plans WHERE project_id = ? AND plan_month = ? AND deleted = 0',
        [project_id || null, plan_month]
      );
      if (existing.length > 0) {
        planId = existing[0].id;
      }
    }

    // Create new plan only if none exists
    if (!planId) {
      const [result] = await conn.query(
        `INSERT INTO content_calendar_plans 
          (client_id, project_id, cycle_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [resolvedClientId, project_id || null, cycle_id || null, plan_month, toNull(primary_goal), toNull(target_audience), toNull(budget_allocation), toNull(hero_offer), req.user.id]
      );
      planId = result.insertId;
    } else {
      // Update plan fields if provided
      const updateFields = [];
      const updateVals = [];
      if (primary_goal) { updateFields.push('primary_goal = ?'); updateVals.push(primary_goal); }
      if (target_audience) { updateFields.push('target_audience = ?'); updateVals.push(target_audience); }
      if (budget_allocation) { updateFields.push('budget_allocation = ?'); updateVals.push(budget_allocation); }
      if (hero_offer) { updateFields.push('hero_offer = ?'); updateVals.push(hero_offer); }
      if (updateFields.length > 0) {
        await conn.query(`UPDATE content_calendar_plans SET ${updateFields.join(', ')} WHERE id = ?`, [...updateVals, planId]);
      }
    }

    // Insert posts
    if (posts && posts.length > 0) {
      for (const post of posts) {
        await conn.query(
          `INSERT INTO content_calendar_posts 
            (plan_id, assigned_to, linked_brief_id, post_no, platform, format, topic, ad_target, shoot_date, posting_date, cta, status, slot_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [planId, post.assigned_to || null, toInt(post.linked_brief_id), toNull(post.post_no), toNull(post.platform),
           toNull(post.format), toNull(post.topic), post.ad_target || 'organic',
           toNull(post.shoot_date), toNull(post.posting_date), toNull(post.cta), post.status || 'planned', post.slot_status || (post.assigned_to ? 'picked_up' : 'open')]
        );
      }
    }

    // Insert shoots
    if (shoots && shoots.length > 0) {
      for (const shoot of shoots) {
        await conn.query(
          `INSERT INTO content_calendar_shoots 
            (plan_id, assigned_to, linked_shoot_id, shoot_date, location, description, num_videos, num_photos, talent, production_notes, status, slot_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [planId, shoot.assigned_to || null, toInt(shoot.linked_shoot_id), toNull(shoot.shoot_date), toNull(shoot.location),
           toNull(shoot.description), shoot.num_videos || 0, shoot.num_photos || 0,
           toNull(shoot.talent), toNull(shoot.production_notes), shoot.status || 'planned', shoot.slot_status || (shoot.assigned_to ? 'picked_up' : 'open')]
        );
      }
    }

    // Insert ads — link to existing ad_campaigns via linked_campaign_id
    if (ads && ads.length > 0) {
      for (const ad of ads) {
        let adNo = await generateNextAdNo(conn);
        let creativeName = ad.creative_name || null;
        let campaignObjective = ad.campaign_objective || 'lead_generation';
        let platform = ad.platform || null;
        let adStatus = ad.ad_status || 'planned';
        let targetAudience = ad.target_audience || null;
        let budget = ad.budget || null;
        let startDate = ad.start_date;
        let endDate = ad.end_date || null;
        let expectedOutcomes = ad.expected_outcomes || null;
        let linkedCampaignId = toInt(ad.linked_campaign_id) || null;

        // If linked to an existing campaign, pull data from it
        if (linkedCampaignId) {
          const [campRows] = await conn.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [linkedCampaignId]);
          if (campRows.length > 0) {
            const camp = campRows[0];
            creativeName = creativeName || camp.campaign_name;
            campaignObjective = camp.objective || campaignObjective;
            platform = platform || camp.platform;
            budget = budget || camp.budget;
            startDate = startDate || (camp.start_date ? camp.start_date.toISOString().split('T')[0] : null);
            endDate = endDate || (camp.end_date ? camp.end_date.toISOString().split('T')[0] : null);
          }
        }

        if (!startDate) startDate = new Date().toISOString().split('T')[0];

        await conn.query(
          `INSERT INTO content_calendar_ads 
            (plan_id, linked_campaign_id, ad_no, creative_name, campaign_objective, platform, ad_status, target_audience, budget, start_date, end_date, expected_outcomes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [planId, linkedCampaignId, adNo, creativeName, campaignObjective, platform,
           adStatus, targetAudience, budget, startDate, endDate, expectedOutcomes]
        );

        // Update the ad_campaign with the linked calendar ad reference
        if (linkedCampaignId) {
          await conn.query('UPDATE ad_campaigns SET linked_calendar_ad_id = LAST_INSERT_ID() WHERE id = ?', [linkedCampaignId]);
        }
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

    const { client_id, project_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, status, posts, shoots, ads } = req.body;

    // Update plan fields
    const planUpdates = {};
    if (client_id !== undefined) planUpdates.client_id = client_id;
    if (project_id !== undefined) planUpdates.project_id = project_id;
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

    // Replace ads — link to existing campaigns
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
          let linkedCampaignId = toInt(ad.linked_campaign_id) || null;
          let creativeName = ad.creative_name || null;
          let campaignObjective = ad.campaign_objective || 'lead_generation';
          let platform = ad.platform || null;
          let adStatus = ad.ad_status || 'planned';
          let targetAudience = ad.target_audience || null;
          let budget = ad.budget || null;
          let startDate = ad.start_date;
          let endDate = ad.end_date || null;
          let expectedOutcomes = ad.expected_outcomes || null;

          // If linked to an existing campaign, pull data from it
          if (linkedCampaignId) {
            const [campRows] = await conn.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [linkedCampaignId]);
            if (campRows.length > 0) {
              const camp = campRows[0];
              creativeName = creativeName || camp.campaign_name;
              campaignObjective = camp.objective || campaignObjective;
              platform = platform || camp.platform;
              budget = budget || camp.budget;
              startDate = startDate || (camp.start_date ? camp.start_date.toISOString().split('T')[0] : null);
              endDate = endDate || (camp.end_date ? camp.end_date.toISOString().split('T')[0] : null);
            }
          }

          if (!startDate) startDate = new Date().toISOString().split('T')[0];

          await conn.query(
            `INSERT INTO content_calendar_ads 
              (plan_id, linked_campaign_id, ad_no, creative_name, campaign_objective, platform, ad_status, target_audience, budget, start_date, end_date, expected_outcomes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, linkedCampaignId, adNo, creativeName, campaignObjective, platform,
             adStatus, targetAudience, budget, startDate, endDate, expectedOutcomes]
          );

          // Update the ad_campaign with the linked calendar ad reference
          if (linkedCampaignId) {
            await conn.query('UPDATE ad_campaigns SET linked_calendar_ad_id = LAST_INSERT_ID() WHERE id = ?', [linkedCampaignId]);
          }
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
    const { month, client_id, cycle_id, project_id } = req.query;

    // Build plan filter
    let planWhere = 'p.deleted = 0';
    const planParams = [];

    if (cycle_id) {
      // Cycle-based view: fetch plans linked to this cycle
      planWhere += ' AND p.cycle_id = ?';
      planParams.push(cycle_id);
    } else if (month) {
      // Month-based view: match plans whose plan_month falls in the same month
      // OR plans that have items scheduled in this month
      const monthStr = month.substring(0, 7); // '2026-07'
      planWhere += ` AND (DATE_FORMAT(p.plan_month, "%Y-%m") = ? OR p.id IN (
        SELECT plan_id FROM content_calendar_posts WHERE DATE_FORMAT(posting_date, "%Y-%m") = ?
        UNION SELECT plan_id FROM content_calendar_shoots WHERE DATE_FORMAT(shoot_date, "%Y-%m") = ?
        UNION SELECT plan_id FROM content_calendar_ads WHERE DATE_FORMAT(start_date, "%Y-%m") = ?
      ))`;
      planParams.push(monthStr, monthStr, monthStr, monthStr);
    } else {
      return res.status(400).json({ message: 'Either month or cycle_id parameter is required' });
    }

    if (client_id) { planWhere += ' AND p.client_id = ?'; planParams.push(client_id); }
    if (project_id) { planWhere += ' AND p.project_id = ?'; planParams.push(project_id); }
    if (!req.user.is_admin) {
      // Show plans created by user OR plans where user has assigned slots
      planWhere += ` AND (p.created_by = ? OR p.id IN (
        SELECT plan_id FROM content_calendar_posts WHERE assigned_to = ?
        UNION SELECT plan_id FROM content_calendar_shoots WHERE assigned_to = ?
        UNION SELECT plan_id FROM content_calendar_ads WHERE assigned_to = ?
      ))`;
      planParams.push(req.user.id, req.user.id, req.user.id, req.user.id);
    }

    // Get plan IDs
    let plans = [];
    try {
      const [rows] = await db.query(
        `SELECT p.id, p.client_id, p.project_id, p.cycle_id, l.business_name AS client_name, pr.title AS project_title
         FROM content_calendar_plans p
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN projects pr ON pr.id = p.project_id
         WHERE ${planWhere}`,
        planParams
      );
      plans = rows;
    } catch (tableErr) {
      if (tableErr.code === 'ER_NO_SUCH_TABLE') {
        return res.json({ posts: [], shoots: [], ads: [], plans: [] });
      }
      // Fallback if assigned_to column doesn't exist yet — use simple created_by filter
      if (tableErr.code === 'ER_BAD_FIELD_ERROR' && !req.user.is_admin) {
        let fallbackWhere = 'p.deleted = 0';
        const fallbackParams = [];
        if (cycle_id) { fallbackWhere += ' AND p.cycle_id = ?'; fallbackParams.push(cycle_id); }
        else if (month) { fallbackWhere += ' AND p.plan_month = ?'; fallbackParams.push(month); }
        if (client_id) { fallbackWhere += ' AND p.client_id = ?'; fallbackParams.push(client_id); }
        if (project_id) { fallbackWhere += ' AND p.project_id = ?'; fallbackParams.push(project_id); }
        fallbackWhere += ' AND p.created_by = ?'; fallbackParams.push(req.user.id);
        const [rows] = await db.query(
          `SELECT p.id, p.client_id, p.project_id, p.cycle_id, l.business_name AS client_name, pr.title AS project_title
           FROM content_calendar_plans p
           LEFT JOIN leads l ON l.id = p.client_id
           LEFT JOIN projects pr ON pr.id = p.project_id
           WHERE ${fallbackWhere}`,
          fallbackParams
        );
        plans = rows;
      } else throw tableErr;
    }

    if (plans.length === 0) {
      return res.json({ posts: [], shoots: [], ads: [], plans: [] });
    }

    const planIds = plans.map(p => p.id);

    // Fetch posts for these plans within the month
    let posts = [];
    try {
      const [rows] = await db.query(
        `SELECT cp.*, p.client_id, l.business_name AS client_name,
                cwr.hook_opening_line AS brief_hook, cwr.content_id_code AS brief_code,
                cwr.content_type AS brief_content_type, cwr.platform AS brief_platform,
                CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name
         FROM content_calendar_posts cp
         JOIN content_calendar_plans p ON p.id = cp.plan_id
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN content_write_requests cwr ON cwr.id = cp.linked_brief_id
         LEFT JOIN users au ON au.id = cp.assigned_to
         WHERE cp.plan_id IN (?)
         ORDER BY cp.id ASC`,
        [planIds]
      );
      posts = rows;
    } catch (colErr) {
      // Fallback if assigned_to column doesn't exist yet
      if (colErr.code === 'ER_BAD_FIELD_ERROR') {
        const [rows] = await db.query(
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
        posts = rows;
      } else throw colErr;
    }

    // Fetch shoots for these plans within the month
    let shoots = [];
    try {
      const [rows] = await db.query(
        `SELECT cs.*, p.client_id, l.business_name AS client_name,
                s.shoot_id_code AS linked_shoot_code, s.project_campaign_name AS shoot_name,
                s.shoot_date AS linked_shoot_date, s.city AS shoot_city,
                CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name
         FROM content_calendar_shoots cs
         JOIN content_calendar_plans p ON p.id = cs.plan_id
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN shoots s ON s.id = cs.linked_shoot_id
         LEFT JOIN users au ON au.id = cs.assigned_to
         WHERE cs.plan_id IN (?)
         ORDER BY cs.id ASC`,
        [planIds]
      );
      shoots = rows;
    } catch (colErr) {
      if (colErr.code === 'ER_BAD_FIELD_ERROR') {
        const [rows] = await db.query(
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
        shoots = rows;
      } else throw colErr;
    }

    // Fetch ads for these plans that overlap with the month
    let ads = [];
    try {
      const [rows] = await db.query(
        `SELECT ca.*, p.client_id, l.business_name AS client_name,
                CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name
         FROM content_calendar_ads ca
         JOIN content_calendar_plans p ON p.id = ca.plan_id
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN users au ON au.id = ca.assigned_to
         WHERE ca.plan_id IN (?)
         ORDER BY ca.start_date ASC`,
        [planIds]
      );
      ads = rows;
    } catch (colErr) {
      if (colErr.code === 'ER_BAD_FIELD_ERROR') {
        const [rows] = await db.query(
          `SELECT ca.*, p.client_id, l.business_name AS client_name
           FROM content_calendar_ads ca
           JOIN content_calendar_plans p ON p.id = ca.plan_id
           LEFT JOIN leads l ON l.id = p.client_id
           WHERE ca.plan_id IN (?)
           ORDER BY ca.start_date ASC`,
          [planIds]
        );
        ads = rows;
      } else throw colErr;
    }

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

// ─── RESCHEDULE (drag & drop) ─────────────────────────────────────────────────
// Updates the date of a single post/shoot/ad item

exports.reschedule = async (req, res) => {
  try {
    const { item_type, item_id, new_date } = req.body;

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    if (!new_date) {
      return res.status(400).json({ message: 'new_date is required' });
    }

    // Validate new_date is not in the past
    const today = new Date().toISOString().split('T')[0];
    if (new_date < today) {
      return res.status(400).json({ message: 'Cannot reschedule to a past date' });
    }

    if (item_type === 'post') {
      const [postRows] = await db.query(
        `SELECT cp.plan_id FROM content_calendar_posts cp WHERE cp.id = ?`,
        [item_id]
      );
      if (postRows.length === 0) return res.status(404).json({ message: 'Post not found' });

      await db.query(
        'UPDATE content_calendar_posts SET posting_date = ? WHERE id = ?',
        [new_date, item_id]
      );
    } else if (item_type === 'shoot') {
      await db.query(
        'UPDATE content_calendar_shoots SET shoot_date = ? WHERE id = ?',
        [new_date, item_id]
      );
    } else if (item_type === 'ad') {
      await db.query(
        'UPDATE content_calendar_ads SET start_date = ? WHERE id = ?',
        [new_date, item_id]
      );
    } else {
      return res.status(400).json({ message: 'Invalid item_type' });
    }

    res.emitSocket('content-calendar:updated', { item_type, item_id, new_date });
    return res.json({ message: 'Rescheduled successfully' });
  } catch (err) {
    console.error('Content calendar reschedule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UPDATE POST STATUS (with workflow enforcement) ───────────────────────────
// Validates that a post can only be marked 'done' if its linked brief is approved

exports.updatePostStatus = async (req, res) => {
  try {
    const { post_id, status } = req.body;

    if (!post_id || !status) {
      return res.status(400).json({ message: 'post_id and status are required' });
    }

    const validStatuses = ['planned', 'in_progress', 'done', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Fetch the post
    const [posts] = await db.query(
      `SELECT cp.*, p.created_by AS plan_creator
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE cp.id = ?`,
      [post_id]
    );

    if (posts.length === 0) return res.status(404).json({ message: 'Post not found' });
    const post = posts[0];

    // Access check
    if (!req.user.is_admin && post.plan_creator !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Workflow enforcement: cannot mark as 'done' if linked brief is not approved
    if (status === 'done' && post.linked_brief_id) {
      const [brief] = await db.query(
        'SELECT id, status FROM content_write_requests WHERE id = ? AND deleted = 0',
        [post.linked_brief_id]
      );
      if (brief.length > 0 && brief[0].status !== 'approved' && brief[0].status !== 'completed') {
        return res.status(400).json({
          message: 'Cannot mark post as done — the linked content brief has not been approved yet.',
          brief_status: brief[0].status,
        });
      }
    }

    await db.query('UPDATE content_calendar_posts SET status = ? WHERE id = ?', [status, post_id]);

    // Update brief_approved flag
    if (status === 'done' && post.linked_brief_id) {
      await db.query('UPDATE content_calendar_posts SET brief_approved = 1 WHERE id = ?', [post_id]);
    }

    res.emitSocket('content-calendar:updated', { post_id, status });
    return res.json({ message: 'Post status updated', post_id, status });
  } catch (err) {
    console.error('Content calendar post status update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── QUICK ADD AD ─────────────────────────────────────────────────────────────
// Creates an ad directly onto a day (finds or creates a plan for that client+month)

exports.quickAd = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { client_id, plan_month, creative_name, campaign_objective, platform, budget, start_date, end_date } = req.body;

    if (!client_id || !plan_month || !start_date) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ message: 'client_id, plan_month, and start_date are required' });
    }

    // Find existing plan or create one
    let [plans] = await conn.query(
      'SELECT id FROM content_calendar_plans WHERE client_id = ? AND plan_month = ? AND deleted = 0',
      [client_id, plan_month]
    );

    let planId;
    if (plans.length > 0) {
      planId = plans[0].id;
    } else {
      const [result] = await conn.query(
        `INSERT INTO content_calendar_plans (client_id, plan_month, status, created_by) VALUES (?, ?, 'active', ?)`,
        [client_id, plan_month, req.user.id]
      );
      planId = result.insertId;
    }

    // Generate ad number and insert
    const adNo = await generateNextAdNo(conn);
    await conn.query(
      `INSERT INTO content_calendar_ads 
        (plan_id, ad_no, creative_name, campaign_objective, platform, ad_status, budget, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?)`,
      [planId, adNo, toNull(creative_name), campaign_objective || 'lead_generation', toNull(platform), toNull(budget), start_date, toNull(end_date)]
    );

    await conn.commit();
    conn.release();

    res.emitSocket('content-calendar:updated', { planId });
    return res.status(201).json({ message: 'Ad added', ad_no: adNo });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Quick ad error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
