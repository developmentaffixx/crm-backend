/**
 * Google Gemini AI helper
 * Uses Gemini 2.0 Flash (free tier: 15 RPM, 1M tokens/day)
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Send a prompt to Gemini and get the response text.
 * @param {string} prompt - The full prompt to send
 * @returns {Promise<string>} - The AI response text
 */
async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured in .env');

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error('Gemini API error:', response.status, errBody);
    throw new Error(`Gemini API error (${response.status}): ${errBody.substring(0, 200)}`);
  }

  const data = await response.json();

  // Extract text from response
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No content returned from Gemini');

  return text;
}

/**
 * Replace {{placeholders}} in a prompt template with actual report data.
 * @param {string} template - Prompt body with placeholders
 * @param {object} report - The parsed report object
 * @returns {string} - Prompt with data filled in
 */
function fillPromptTemplate(template, report) {
  const platformLabel = Array.isArray(report.platform)
    ? report.platform.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
    : (report.platform || 'Instagram');

  const monthLabel = report.reporting_month
    ? new Date(report.reporting_month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  // Build content overview text
  let contentOverviewText = 'No content data';
  if (report.content_overview && Array.isArray(report.content_overview)) {
    contentOverviewText = report.content_overview
      .map(c => `${c.type}: Planned ${c.planned || 0}, Published ${c.published || 0}`)
      .join('\n');
  }

  // Build account performance text
  let accountPerfText = 'No account performance data';
  if (report.account_performance && typeof report.account_performance === 'object') {
    const ap = report.account_performance;
    const lines = [];
    if (ap.views) lines.push(`Views: ${ap.views}`);
    if (ap.accounts_reached) lines.push(`Accounts Reached: ${ap.accounts_reached}`);
    if (ap.content_shared) lines.push(`Content Shared: ${ap.content_shared}`);
    if (ap.profile_visits) lines.push(`Profile Visits: ${ap.profile_visits}`);
    if (ap.interactions) lines.push(`Interactions: ${ap.interactions}`);
    if (ap.new_followers) lines.push(`New Followers: ${ap.new_followers}`);
    if (ap.external_link_taps) lines.push(`External Link Taps: ${ap.external_link_taps}`);
    if (lines.length > 0) accountPerfText = lines.join('\n');
  }

  // Build most viewed posts text
  let mostViewedText = 'No top posts data';
  if (report.most_viewed_posts && Array.isArray(report.most_viewed_posts) && report.most_viewed_posts.length > 0) {
    mostViewedText = report.most_viewed_posts.map((p, i) => {
      const parts = [`Post ${i + 1}:`];
      if (p.views) parts.push(`Views: ${p.views}`);
      if (p.reach) parts.push(`Reach: ${p.reach}`);
      if (p.likes) parts.push(`Likes: ${p.likes}`);
      if (p.comments) parts.push(`Comments: ${p.comments}`);
      if (p.shares) parts.push(`Shares: ${p.shares}`);
      if (p.saves) parts.push(`Saves: ${p.saves}`);
      if (p.reposts) parts.push(`Reposts: ${p.reposts}`);
      if (p.profile_activities) parts.push(`Profile Activities: ${p.profile_activities}`);
      if (p.follower_pct) parts.push(`Follower %: ${p.follower_pct}`);
      if (p.non_follower_pct) parts.push(`Non-Follower %: ${p.non_follower_pct}`);
      if (p.gender_female_pct) parts.push(`Women: ${p.gender_female_pct}%`);
      if (p.gender_male_pct) parts.push(`Men: ${p.gender_male_pct}%`);
      return parts.join(', ');
    }).join('\n');
  }

  // Build ads campaigns text
  let adsCampaignsText = 'No ads data';
  if (report.ads_campaigns && Array.isArray(report.ads_campaigns) && report.ads_campaigns.length > 0) {
    adsCampaignsText = report.ads_campaigns.map((c, i) => {
      let line = `Campaign ${i + 1}: ${c.name || 'Unnamed'}`;
      if (c.total_spent) line += ` | Spent: Rs.${c.total_spent}`;
      if (c.total_with_gst) line += ` (with GST: Rs.${c.total_with_gst})`;
      if (c.messages) line += ` | Messages: ${c.messages}`;
      if (c.calls) line += ` | Calls: ${c.calls}`;
      if (c.enquiries) line += ` | Enquiries: ${c.enquiries}`;
      if (c.ad_breakdown && c.ad_breakdown.length > 0) {
        line += '\n  Ad-wise: ' + c.ad_breakdown.map(b => `${b.creative_name}: ${b.result_count}`).join(', ');
      }
      return line;
    }).join('\n');
  }

  // Build demographics text
  let demographicsText = 'No demographics data';
  if (report.audience_demographics && typeof report.audience_demographics === 'object') {
    const d = report.audience_demographics;
    const parts = [];
    if (d.cities && d.cities.length > 0) {
      parts.push('Cities: ' + d.cities.map(c => `${c.name} ${c.pct}%`).join(', '));
    }
    if (d.age_ranges && d.age_ranges.length > 0) {
      parts.push('Age: ' + d.age_ranges.map(a => `${a.range}: ${a.pct}%`).join(', '));
    }
    if (d.gender) {
      parts.push(`Gender: Women ${d.gender.female_pct || '-'}%, Men ${d.gender.male_pct || '-'}%`);
    }
    if (parts.length > 0) demographicsText = parts.join('\n');
  }

  // Build recommendations text
  let recommendationsText = 'No recommendations';
  if (report.recommendations && Array.isArray(report.recommendations)) {
    const filtered = report.recommendations.filter(r => r);
    if (filtered.length > 0) recommendationsText = filtered.map((r, i) => `${i + 1}. ${r}`).join('\n');
  }

  // Replace all placeholders
  return template
    .replace(/\{\{project_name\}\}/g, report.project_title || 'Unknown Project')
    .replace(/\{\{client_name\}\}/g, report.client_name || report.project_title || 'Client')
    .replace(/\{\{month\}\}/g, monthLabel)
    .replace(/\{\{platforms\}\}/g, platformLabel)
    .replace(/\{\{content_overview\}\}/g, contentOverviewText)
    .replace(/\{\{account_performance\}\}/g, accountPerfText)
    .replace(/\{\{most_viewed_posts\}\}/g, mostViewedText)
    .replace(/\{\{ads_campaigns\}\}/g, adsCampaignsText)
    .replace(/\{\{audience_demographics\}\}/g, demographicsText)
    .replace(/\{\{recommendations\}\}/g, recommendationsText);
}

module.exports = { generateWithGemini, fillPromptTemplate };
