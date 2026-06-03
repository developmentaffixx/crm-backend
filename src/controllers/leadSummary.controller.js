const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../config/db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * POST /api/leads/:id/summary
 * Generate AI summary + next action prediction for a lead's follow-ups
 */
exports.generateSummary = async (req, res) => {
  try {
    const leadId = req.params.id;

    // Fetch lead details
    const [leads] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [leadId]);
    if (leads.length === 0) return res.status(404).json({ message: 'Lead not found' });
    const lead = leads[0];

    // Fetch follow-ups
    const [followUps] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = ?
       ORDER BY f.created_at ASC`,
      [leadId]
    );

    if (followUps.length === 0) {
      return res.json({
        summary: 'No follow-ups recorded yet. Start by making the first contact.',
        nextAction: 'Make an initial follow-up call or send an introductory email.',
        nextActionType: 'Phone Call',
        suggestedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        stats: { total: 0, types: {}, lastContact: null, daysSinceLastContact: null }
      });
    }

    // Build stats
    const stats = buildStats(followUps);

    // Build prompt for Gemini
    const prompt = buildPrompt(lead, followUps, stats);

    // Call Gemini AI
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse AI response
    const parsed = parseAIResponse(text);

    return res.json({
      ...parsed,
      stats,
    });
  } catch (err) {
    console.error('Lead summary error:', err.message || err);
    return res.status(500).json({ message: err.message || 'Failed to generate summary' });
  }
};

function buildStats(followUps) {
  const types = {};
  followUps.forEach(fu => {
    types[fu.type] = (types[fu.type] || 0) + 1;
  });

  const lastFollowUp = followUps[followUps.length - 1];
  const firstFollowUp = followUps[0];
  const daysSinceLastContact = Math.floor(
    (Date.now() - new Date(lastFollowUp.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const totalDays = Math.max(1, Math.floor(
    (new Date(lastFollowUp.created_at) - new Date(firstFollowUp.created_at)) / (1000 * 60 * 60 * 24)
  ));
  const avgGap = followUps.length > 1 ? Math.round(totalDays / (followUps.length - 1)) : 0;

  return {
    total: followUps.length,
    types,
    lastContact: lastFollowUp.created_at,
    lastContactType: lastFollowUp.type,
    daysSinceLastContact,
    firstContact: firstFollowUp.created_at,
    avgGapDays: avgGap,
  };
}

function buildPrompt(lead, followUps, stats) {
  const followUpText = followUps.map((fu, i) =>
    `${i + 1}. [${fu.created_at ? new Date(fu.created_at).toLocaleDateString() : 'Unknown'}] (${fu.type}) by ${fu.created_by_name}: "${fu.note}"`
  ).join('\n');

  return `You are a CRM sales assistant. Analyze the following lead's follow-up history and provide:
1. A brief summary (2-3 sentences) of the overall interaction history
2. A suggested next action (what specifically to do next)
3. The recommended follow-up type (Phone Call, Email, WhatsApp, Meeting, or Other)
4. A suggested date for the next follow-up (YYYY-MM-DD format)

Lead Information:
- Name: ${lead.name}
- Business: ${lead.business_name || 'N/A'}
- Service Required: ${lead.service_required || 'N/A'}
- Temperature: ${lead.temperature}
- Status: ${lead.status}
- Source: ${lead.source || 'N/A'}
- Days since last contact: ${stats.daysSinceLastContact}
- Total follow-ups: ${stats.total}
- Average gap between follow-ups: ${stats.avgGapDays} days

Follow-up History (oldest first):
${followUpText}

Respond in this exact JSON format (no markdown, no code blocks):
{"summary": "...", "nextAction": "...", "nextActionType": "Phone Call|Email|WhatsApp|Meeting|Other", "suggestedDate": "YYYY-MM-DD"}`;
}

function parseAIResponse(text) {
  try {
    // Remove markdown code blocks if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || 'Unable to generate summary.',
      nextAction: parsed.nextAction || 'Follow up with the lead.',
      nextActionType: parsed.nextActionType || 'Phone Call',
      suggestedDate: parsed.suggestedDate || new Date(Date.now() + 86400000).toISOString().split('T')[0],
    };
  } catch (e) {
    // If JSON parsing fails, extract text manually
    return {
      summary: text.slice(0, 300),
      nextAction: 'Follow up with the lead.',
      nextActionType: 'Phone Call',
      suggestedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    };
  }
}
