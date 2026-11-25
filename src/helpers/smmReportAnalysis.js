/**
 * SMM monthly report - rule-based analysis engine.
 *
 * Every sentence is built from the numbers the delivery team entered (and the
 * previous month's entered numbers, when a prior report exists). Nothing is
 * inferred beyond that, so no unsupported performance claims are produced.
 *
 *   computeFacts(inputs, prevInputs)  -> deterministic numbers (never hand-edited)
 *   buildNarrative(inputs, facts, ctx)-> editable text blocks used on the slides
 */

const METRICS = [
  { key: 'reach', label: 'Reach' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'followers_gained', label: 'Followers Gained' },
  { key: 'profile_visits', label: 'Profile Visits' },
  { key: 'link_clicks', label: 'Link Clicks' },
  { key: 'video_views', label: 'Video Views' },
];

const PLATFORM_LABELS = {
  instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  linkedin: 'LinkedIn', twitter: 'X (Twitter)', google_business: 'Google Business', whatsapp: 'WhatsApp',
};

const platformLabel = (k) => PLATFORM_LABELS[k] || String(k || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// A change smaller than this (in %) is reported as "stable".
const STABLE_BAND = 5;
// A drop at least this large (in %) is escalated to "areas requiring attention".
const ATTENTION_DROP = 15;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
const fmt = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct1 = (n) => (n === null || n === undefined ? '-' : `${Number(n).toFixed(1)}%`);
const money = (n) => (n === null || n === undefined ? '-' : `Rs. ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

function monthLabel(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function change(cur, prev, lowerIsBetter = false) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) {
    return { delta: null, pct: null, direction: null, sentiment: null };
  }
  const delta = cur - prev;
  let pct = null;
  let direction;
  if (prev === 0) {
    direction = cur > 0 ? 'up' : 'flat';
  } else {
    pct = (delta / Math.abs(prev)) * 100;
    direction = pct >= STABLE_BAND ? 'up' : pct <= -STABLE_BAND ? 'down' : 'flat';
  }
  let sentiment = 'neutral';
  if (direction !== 'flat') sentiment = ((direction === 'up') !== lowerIsBetter) ? 'positive' : 'negative';
  return { delta, pct, direction, sentiment };
}

const interactionsOf = (o) => {
  const parts = [num(o.likes), num(o.comments), num(o.shares), num(o.saves)];
  return parts.some(p => p !== null) ? sum(parts) : null;
};

/** Per-platform + overall numbers for one month of inputs. */
function summarise(inputs) {
  const pm = inputs.platform_metrics || {};
  const selected = (inputs.platforms && inputs.platforms.length) ? inputs.platforms : Object.keys(pm);

  const platforms = selected.map((key) => {
    const raw = pm[key] || {};
    const m = {};
    METRICS.forEach(({ key: k }) => { m[k] = num(raw[k]); });
    let engagementDerived = false;
    if (m.engagement === null) {
      const derived = interactionsOf(m);
      if (derived !== null) { m.engagement = derived; engagementDerived = true; }
    }
    const extra = Array.isArray(raw.other) ? raw.other.filter(o => o && o.label && num(o.value) !== null).map(o => ({ label: o.label, value: num(o.value) })) : [];
    return {
      key, label: platformLabel(key), metrics: m, extra, engagementDerived,
      engagementRate: m.reach ? (m.engagement !== null ? (m.engagement / m.reach) * 100 : null) : null,
      hasData: METRICS.some(({ key: k }) => m[k] !== null),
    };
  });

  const totals = {};
  METRICS.forEach(({ key: k }) => {
    const vals = platforms.map(p => p.metrics[k]).filter(v => v !== null);
    totals[k] = vals.length ? sum(vals) : null;
  });
  const engagementRate = totals.reach ? (totals.engagement !== null ? (totals.engagement / totals.reach) * 100 : null) : null;

  // Deliverables
  const rows = (inputs.deliverables || []).map((d) => {
    const planned = num(d.planned);
    const completed = num(d.completed);
    return {
      type: d.type || 'Other', planned, completed,
      pct: planned ? ((completed || 0) / planned) * 100 : null,
      pending: planned !== null ? Math.max(planned - (completed || 0), 0) : null,
    };
  }).filter(r => r.planned !== null || r.completed !== null);
  const plannedTotal = sum(rows.map(r => r.planned));
  const completedTotal = sum(rows.map(r => r.completed));
  const deliverables = {
    rows, plannedTotal, completedTotal,
    pct: plannedTotal ? (completedTotal / plannedTotal) * 100 : null,
    pendingItems: (inputs.pending_items || []).filter(p => p && (p.item || p.reason)),
  };

  // Ads
  const a = inputs.ads || {};
  const campaigns = (a.campaigns || []).map(c => ({
    name: c.name || 'Campaign', objective: c.objective || '',
    spend: num(c.spend), reach: num(c.reach), impressions: num(c.impressions), clicks: num(c.clicks),
    leads: num(c.leads), conversions: num(c.conversions),
  }));
  (a.campaigns || []).forEach((raw, i) => {
    campaigns[i].gst = num(raw.gst); campaigns[i].messages = num(raw.messages); campaigns[i].calls = num(raw.calls);
  });
  const pick = (k) => (num(a[k]) !== null ? num(a[k]) : (campaigns.some(c => c[k] !== null && c[k] !== undefined) ? sum(campaigns.map(c => c[k])) : null));
  const ads = {
    enabled: !!a.enabled,
    spend: pick('spend'), reach: pick('reach'), impressions: pick('impressions'),
    clicks: pick('clicks'), leads: pick('leads'), conversions: pick('conversions'),
    gst: pick('gst'), messages: pick('messages'), calls: pick('calls'),
    campaigns,
  };
  ads.enquiries = ads.messages !== null || ads.calls !== null ? (ads.messages || 0) + (ads.calls || 0) : null;
  ads.cpl = ads.spend !== null && ads.leads ? ads.spend / ads.leads : null;
  ads.ctr = ads.clicks !== null && ads.impressions ? (ads.clicks / ads.impressions) * 100 : null;
  ads.cpc = ads.spend !== null && ads.clicks ? ads.spend / ads.clicks : null;
  ads.costPerConversion = ads.spend !== null && ads.conversions ? ads.spend / ads.conversions : null;
  campaigns.forEach(c => { c.cpl = c.spend !== null && c.leads ? c.spend / c.leads : null; });

  return { platforms, totals, engagementRate, deliverables, ads };
}

/** Content items with score + ranking. */
function rankContent(inputs) {
  const items = (inputs.top_content || []).filter(c => c && (c.title || c.link)).map((c) => {
    const direct = num(c.engagement);
    const score = direct !== null ? direct : interactionsOf(c);
    return {
      title: c.title || c.link, platform: c.platform || '', format: (c.format || 'Post').trim(),
      reach: num(c.reach), likes: num(c.likes), comments: num(c.comments), shares: num(c.shares), saves: num(c.saves),
      views: num(c.views), score, link: c.link || '', notes: c.notes || '', image_url: c.image_url || '',
    };
  });
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  const isVideo = (f) => /reel|video|short/i.test(f);
  const byFormat = {};
  items.forEach((i) => {
    if (i.score === null) return;
    const k = i.format.toLowerCase();
    (byFormat[k] = byFormat[k] || { format: i.format, n: 0, total: 0 });
    byFormat[k].n += 1; byFormat[k].total += i.score;
  });
  const formats = Object.values(byFormat).map(f => ({ ...f, avg: f.total / f.n })).sort((a, b) => b.avg - a.avg);
  return {
    items,
    bestPost: items.find(i => !isVideo(i.format) && i.score !== null) || null,
    bestVideo: items.find(i => isVideo(i.format) && i.score !== null) || null,
    formats,
  };
}

function summariseDemographics(inputs) {
  const d = inputs.demographics || {};
  const cities = (d.cities || []).filter(c => c && c.name && num(c.pct) !== null).map(c => ({ name: c.name, pct: num(c.pct) }));
  const ageRanges = (d.age_ranges || []).filter(a => a && a.range && num(a.pct) !== null).map(a => ({ range: a.range, pct: num(a.pct) }));
  const female = num(d.gender && d.gender.female_pct);
  const male = num(d.gender && d.gender.male_pct);
  return { cities, ageRanges, gender: { female, male }, hasData: !!(cities.length || ageRanges.length || female !== null || male !== null) };
}

function computeFacts(inputs, prevInputs) {
  const cur = summarise(inputs);
  const prev = prevInputs ? summarise(prevInputs) : null;

  const kpis = METRICS.map(({ key, label }) => {
    const value = cur.totals[key];
    const p = prev ? prev.totals[key] : null;
    return { key, label, value, prev: p, ...change(value, p) };
  }).filter(k => k.value !== null || k.prev !== null);

  const rateChange = prev ? change(cur.engagementRate, prev.engagementRate) : change(null, null);

  const platforms = cur.platforms.map((p) => {
    const pp = prev ? prev.platforms.find(x => x.key === p.key) : null;
    return {
      ...p,
      prevMetrics: pp ? pp.metrics : null,
      changes: pp ? Object.fromEntries(METRICS.map(({ key }) => [key, change(p.metrics[key], pp.metrics[key])])) : null,
    };
  });

  const adChanges = prev && cur.ads.enabled && prev.ads.enabled ? {
    spend: change(cur.ads.spend, prev.ads.spend),
    leads: change(cur.ads.leads, prev.ads.leads),
    cpl: change(cur.ads.cpl, prev.ads.cpl, true),
    ctr: change(cur.ads.ctr, prev.ads.ctr),
    conversions: change(cur.ads.conversions, prev.ads.conversions),
  } : null;

  const delChange = prev ? change(cur.deliverables.pct, prev.deliverables.pct) : change(null, null);

  return {
    month: inputs.reporting_month || null,
    hasPrevious: !!prev,
    previousMonth: prevInputs ? prevInputs.reporting_month || null : null,
    kpis,
    engagementRate: cur.engagementRate,
    prevEngagementRate: prev ? prev.engagementRate : null,
    engagementRateChange: rateChange,
    platforms,
    deliverables: { ...cur.deliverables, prevPct: prev ? prev.deliverables.pct : null, change: delChange },
    ads: { ...cur.ads, changes: adChanges, prev: prev ? { spend: prev.ads.spend, leads: prev.ads.leads, cpl: prev.ads.cpl, ctr: prev.ads.ctr } : null },
    content: rankContent(inputs),
    demographics: summariseDemographics(inputs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrative
// ─────────────────────────────────────────────────────────────────────────────

const describe = (k) => {
  if (k.pct === null || k.prev === null) return `${k.label}: ${fmt(k.value)}`;
  const dir = k.pct >= 0 ? 'up' : 'down';
  return `${k.label} ${dir} ${Math.abs(k.pct).toFixed(1)}% (${fmt(k.prev)} to ${fmt(k.value)})`;
};

function buildNarrative(inputs, facts) {
  const info = inputs.info || {};
  const d = facts.deliverables;
  const ads = facts.ads;
  const month = monthLabel(inputs.reporting_month);
  const hasPrev = facts.hasPrevious;
  const platformsUsed = facts.platforms.filter(p => p.hasData);
  const kpiMap = Object.fromEntries(facts.kpis.map(k => [k.key, k]));
  const ups = facts.kpis.filter(k => k.direction === 'up' && k.pct !== null).sort((a, b) => b.pct - a.pct);
  const downs = facts.kpis.filter(k => k.direction === 'down').sort((a, b) => a.pct - b.pct);

  // 1. Overview
  const ov = [];
  if (d.plannedTotal) ov.push(`${d.completedTotal} of ${d.plannedTotal} planned deliverables were completed (${pct1(d.pct)}).`);
  if (kpiMap.reach && kpiMap.reach.value !== null) ov.push(`Total reach across managed platforms was ${fmt(kpiMap.reach.value)}${kpiMap.reach.pct !== null ? ` (${kpiMap.reach.pct >= 0 ? '+' : ''}${kpiMap.reach.pct.toFixed(1)}% vs previous month)` : ''}.`);
  if (kpiMap.followers_gained && kpiMap.followers_gained.value !== null) ov.push(`${fmt(kpiMap.followers_gained.value)} new followers were gained.`);
  if (facts.engagementRate !== null) ov.push(`Overall engagement was ${pct1(facts.engagementRate)} of reach.`);
  if (ads.enabled && ads.leads !== null) ov.push(`Advertising generated ${fmt(ads.leads)} leads${ads.cpl !== null ? ` at ${money(ads.cpl)} per lead` : ''}.`);
  if (!hasPrev) ov.push('No previous-month report exists for this project, so month-on-month comparison is not included.');
  const overview = ov.join(' ');

  // 2. Deliverables summary
  const delivSummary = [];
  if (d.plannedTotal) {
    delivSummary.push(`Overall completion: ${pct1(d.pct)} (${d.completedTotal}/${d.plannedTotal}).`);
    if (d.change.pct !== null && d.prevPct !== null) delivSummary.push(`Previous month completion was ${pct1(d.prevPct)}.`);
    d.rows.filter(r => r.pending > 0).forEach(r => delivSummary.push(`${r.type}: ${r.pending} pending of ${r.planned} planned.`));
    d.rows.filter(r => r.planned && r.completed > r.planned).forEach(r => delivSummary.push(`${r.type}: delivered ${r.completed - r.planned} more than planned.`));
  }

  // 8. Analysis blocks
  const worked = []; const notWorked = []; const improvements = []; const attention = [];

  if (d.plannedTotal && d.pct >= 100) worked.push(`All planned deliverables were completed (${d.completedTotal}/${d.plannedTotal}).`);
  else if (d.plannedTotal && d.pct >= 90) worked.push(`Delivery stayed close to plan at ${pct1(d.pct)} completion.`);
  const best = facts.content.items.find(i => i.score !== null);
  if (best) worked.push(`"${best.title}" (${best.format}${best.platform ? ', ' + platformLabel(best.platform.toLowerCase()) : ''}) was the top content with ${fmt(best.score)} interactions${best.reach ? ` on ${fmt(best.reach)} reach` : ''}.`);
  const withRate = platformsUsed.filter(p => p.engagementRate !== null);
  if (withRate.length >= 2) {
    const sorted = [...withRate].sort((a, b) => b.engagementRate - a.engagementRate);
    worked.push(`${sorted[0].label} had the strongest engagement rate (${pct1(sorted[0].engagementRate)} of reach) among the managed platforms.`);
  }
  if (info.achievements) worked.push(`Team-reported achievements: ${info.achievements}`);
  if (ads.enabled && ads.changes && ads.changes.cpl.sentiment === 'positive') worked.push(`Cost per lead improved from ${money(ads.prev.cpl)} to ${money(ads.cpl)}.`);

  if (d.plannedTotal && d.pct < 90) notWorked.push(`Deliverable completion was ${pct1(d.pct)}, below plan (${d.completedTotal}/${d.plannedTotal}).`);
  downs.forEach(k => notWorked.push(`${describe(k)}.`));
  if (ads.enabled && ads.changes && ads.changes.cpl.sentiment === 'negative') notWorked.push(`Cost per lead rose from ${money(ads.prev.cpl)} to ${money(ads.cpl)}.`);
  if (ads.enabled && ads.changes && ads.changes.leads.direction === 'down') notWorked.push(`Leads fell from ${fmt(ads.prev.leads)} to ${fmt(ads.leads)}.`);
  if (withRate.length >= 2) {
    const sorted = [...withRate].sort((a, b) => a.engagementRate - b.engagementRate);
    notWorked.push(`${sorted[0].label} had the lowest engagement rate (${pct1(sorted[0].engagementRate)} of reach).`);
  }
  if (info.challenges) notWorked.push(`Challenges reported by the team: ${info.challenges}`);

  ups.forEach(k => improvements.push(`${describe(k)}.`));
  if (d.change.direction === 'up') improvements.push(`Deliverable completion improved from ${pct1(d.prevPct)} to ${pct1(d.pct)}.`);
  if (facts.engagementRateChange.direction === 'up') improvements.push(`Engagement rate improved from ${pct1(facts.prevEngagementRate)} to ${pct1(facts.engagementRate)}.`);
  if (!hasPrev) improvements.push('Improvement tracking starts next month, once this month is on record.');

  downs.filter(k => k.pct <= -ATTENTION_DROP).forEach(k => attention.push(`${k.label} dropped by ${Math.abs(k.pct).toFixed(1)}%. Review what changed in content mix, posting frequency or timing.`));
  facts.platforms.forEach((p) => {
    if (!p.changes) return;
    ['reach', 'engagement', 'followers_gained'].forEach((k) => {
      const c = p.changes[k];
      if (c && c.pct !== null && c.pct <= -ATTENTION_DROP) attention.push(`${p.label} ${k.replace('_', ' ')} fell ${Math.abs(c.pct).toFixed(1)}% (${fmt(p.prevMetrics[k])} to ${fmt(p.metrics[k])}).`);
    });
  });
  d.pendingItems.forEach(p => attention.push(`Pending: ${p.item || 'deliverable'}${p.reason ? ` (reason: ${p.reason})` : ''}.`));
  if (info.client_dependencies) attention.push(`Client-side dependencies: ${info.client_dependencies}`);
  const missingPlatforms = facts.platforms.filter(p => !p.hasData).map(p => p.label);
  if (missingPlatforms.length) attention.push(`No metrics were entered for: ${missingPlatforms.join(', ')}.`);
  if (platformsUsed.some(p => p.engagementDerived)) attention.push('Engagement for some platforms was calculated as likes + comments + shares + saves because a total was not entered.');
  if (facts.platforms.length > 1) attention.push('Total reach and impressions are the sum of platform-reported figures and may include overlapping audiences.');

  // 9. Recommendations
  const content = []; const formats = []; const campaignIdeas = []; const audience = []; const adRecs = [];
  const fm = facts.content.formats;
  if (fm.length >= 2) {
    formats.push(`${fm[0].format} content averaged ${fmt(Math.round(fm[0].avg))} interactions per item versus ${fmt(Math.round(fm[fm.length - 1].avg))} for ${fm[fm.length - 1].format} (based on ${facts.content.items.length} items entered). Give ${fm[0].format} a larger share of next month's calendar and test it against the weaker format.`);
  } else if (fm.length === 1) {
    formats.push(`Only ${fm[0].format} content was entered for performance review, so format comparison is not possible. Enter at least two formats next month to compare.`);
  }
  if (best) content.push(`Build on the theme and style of "${best.title}", which led the month with ${fmt(best.score)} interactions.${best.notes ? ' Team note: ' + best.notes : ''}`);
  const weakContent = facts.content.items.filter(i => i.score !== null).slice(-1)[0];
  if (weakContent && facts.content.items.filter(i => i.score !== null).length >= 3) content.push(`Review "${weakContent.title}" (${fmt(weakContent.score)} interactions), the lowest of the items entered, for hook, visual and caption changes.`);
  d.rows.filter(r => r.pending > 0).forEach(r => content.push(`Recover the ${r.pending} pending ${r.type.toLowerCase()} first so the calendar stays on plan.`));
  if (kpiMap.saves && kpiMap.saves.direction === 'up') content.push('Saves are rising, so continue educational or reference-style posts that people keep.');
  if (kpiMap.shares && kpiMap.shares.direction === 'down') content.push('Shares declined, so add more shareable formats such as relatable or informational posts.');
  if (info.campaigns) campaignIdeas.push(`Review the results of this month's campaigns (${info.campaigns}) and repeat the elements that matched the top content.`);
  if (ads.enabled && ads.campaigns.length > 1) {
    const withCpl = ads.campaigns.filter(c => c.cpl !== null).sort((a, b) => a.cpl - b.cpl);
    if (withCpl.length >= 2) campaignIdeas.push(`"${withCpl[0].name}" had the lowest cost per lead (${money(withCpl[0].cpl)}), against ${money(withCpl[withCpl.length - 1].cpl)} for "${withCpl[withCpl.length - 1].name}". Shift budget toward the stronger campaign.`);
  }
  if (!campaignIdeas.length) campaignIdeas.push('Plan one themed campaign for next month using the best-performing content format as its base.');

  const fg = kpiMap.followers_gained; const pv = kpiMap.profile_visits;
  if (pv && fg && pv.value && fg.value !== null) audience.push(`${fmt(pv.value)} profile visits converted to ${fmt(fg.value)} new followers (${pct1((fg.value / pv.value) * 100)}). Keep bio, highlights and pinned posts current to improve this.`);
  if (fg && fg.direction === 'down') audience.push(`Follower gain fell ${Math.abs(fg.pct).toFixed(1)}%. Increase reach-oriented formats and collaborations to widen the audience.`);
  const gain = [...platformsUsed].filter(p => p.metrics.followers_gained !== null).sort((a, b) => b.metrics.followers_gained - a.metrics.followers_gained);
  if (gain.length >= 2) audience.push(`${gain[0].label} added the most followers (${fmt(gain[0].metrics.followers_gained)}). Keep it as the primary growth channel.`);
  if (!audience.length) audience.push('Track followers gained and profile visits every month so audience growth actions can be tied to data.');

  if (ads.enabled) {
    if (ads.changes) {
      if (ads.changes.cpl.sentiment === 'negative') adRecs.push(`Cost per lead rose to ${money(ads.cpl)} from ${money(ads.prev.cpl)}. Review audience targeting and creatives before increasing spend.`);
      else if (ads.changes.cpl.sentiment === 'positive') adRecs.push(`Cost per lead fell to ${money(ads.cpl)} from ${money(ads.prev.cpl)}. Keep the current setup and scale gradually.`);
      if (ads.changes.ctr.direction === 'down') adRecs.push(`Click-through rate dropped to ${pct1(ads.ctr)} from ${pct1(ads.prev.ctr)}. Refresh ad creatives and headlines.`);
    }
    if (ads.cpl !== null && !adRecs.length) adRecs.push(`Current cost per lead is ${money(ads.cpl)} on ${money(ads.spend)} spend. Use this as the baseline for next month.`);
    if (ads.leads !== null && ads.conversions !== null && ads.leads > 0 && ads.conversions === 0) adRecs.push('Leads were generated but no conversions were recorded. Confirm lead follow-up with the client.');
    if (!adRecs.length) adRecs.push('Enter ad spend and leads to enable cost-per-lead analysis.');
  }

  // 10. Action plan
  const topFormat = fm[0] ? fm[0].format : null;
  const bestPlatform = withRate.length ? [...withRate].sort((a, b) => b.engagementRate - a.engagementRate)[0].label : null;
  const dirParts = [];
  if (topFormat) dirParts.push(`increase ${topFormat} content`);
  if (bestPlatform) dirParts.push(`keep ${bestPlatform} as the lead platform`);
  if (downs.length) dirParts.push(`recover ${downs.slice(0, 2).map(k => k.label.toLowerCase()).join(' and ')}`);
  const direction = dirParts.length ? `Next month: ${dirParts.join(', ')}.` : 'Maintain the current content mix and review results once more data is entered.';

  const nextPlan = (inputs.next_month_plan || []).filter(r => r && r.type && num(r.planned) !== null);
  const proposedDeliverables = nextPlan.length
    ? nextPlan.map(r => ({ type: r.type, proposed: num(r.planned), note: r.note || 'As planned by delivery team' }))
    : d.rows.map(r => ({
      type: r.type, proposed: (r.planned || 0) + (r.pending || 0),
      note: r.pending > 0 ? `${r.planned} planned + ${r.pending} carried over` : 'Same as this month',
    }));

  const targets = [];
  facts.kpis.filter(k => ['reach', 'engagement', 'followers_gained', 'profile_visits'].includes(k.key) && k.value).forEach((k) => {
    if (k.direction === 'down' && k.prev) targets.push({ metric: k.label, current: k.value, target: k.prev, basis: 'Return to previous month level' });
    else targets.push({ metric: k.label, current: k.value, target: Math.round(k.value * 1.1), basis: 'Proposed +10% on this month (editable)' });
  });
  if (d.plannedTotal) targets.push({ metric: 'Deliverable completion', current: Number(d.pct.toFixed(1)), target: 100, basis: 'Complete all planned deliverables' });
  if (ads.enabled && ads.cpl !== null) targets.push({ metric: 'Cost per lead', current: Number(ads.cpl.toFixed(2)), target: ads.changes && ads.changes.cpl.sentiment === 'negative' ? Number(ads.prev.cpl.toFixed(2)) : Number(ads.cpl.toFixed(2)), basis: ads.changes && ads.changes.cpl.sentiment === 'negative' ? 'Return to previous month level' : 'Hold at current level' });

  const priorities = [];
  if (d.rows.some(r => r.pending > 0)) priorities.push('Clear pending deliverables carried over from this month.');
  if (downs.length) priorities.push(`Recover declining metrics: ${downs.map(k => k.label).join(', ')}.`);
  if (topFormat) priorities.push(`Scale ${topFormat} content, the best-performing format this month.`);
  if (ads.enabled) priorities.push('Optimise ad spend toward the lowest cost per lead.');
  if (!priorities.length) priorities.push('Maintain delivery consistency and keep recording metrics for trend analysis.');

  const actions = [];
  d.pendingItems.forEach(p => actions.push(`Complete ${p.item || 'pending deliverable'}${p.reason ? ` (blocked by: ${p.reason})` : ''}.`));
  if (info.client_dependencies) actions.push(`Follow up with client on: ${info.client_dependencies}`);
  downs.filter(k => k.pct <= -ATTENTION_DROP).forEach(k => actions.push(`Investigate the ${k.label.toLowerCase()} decline and adjust the content plan.`));
  if (best) actions.push(`Plan follow-up content to "${best.title}".`);
  if (ads.enabled) actions.push('Share the ad performance review with the client and confirm next month budget.');
  actions.push('Share the approved report with the client and agree on next month content direction.');

  return {
    overview,
    account_note: info.observations || '',
    deliverables_summary: delivSummary,
    performance_note: [
      ...ups.slice(0, 2).map(k => `${describe(k)}.`),
      ...downs.slice(0, 2).map(k => `${describe(k)}.`),
    ],
    platform_note: withRate.length >= 2
      ? [`Engagement rate by platform: ${[...withRate].sort((a, b) => b.engagementRate - a.engagementRate).map(p => `${p.label} ${pct1(p.engagementRate)}`).join(', ')}.`]
      : [],
    audience_note: [
      ...(fg && fg.value !== null ? [`${fmt(fg.value)} followers gained${fg.pct !== null ? ` (${fg.pct >= 0 ? '+' : ''}${fg.pct.toFixed(1)}% vs previous month)` : ''}.`] : []),
      ...(pv && pv.value !== null ? [`${fmt(pv.value)} profile visits${pv.pct !== null ? ` (${pv.pct >= 0 ? '+' : ''}${pv.pct.toFixed(1)}%)` : ''}.`] : []),
    ],
    content_notes: [
      ...(facts.content.bestPost ? [`Best post: "${facts.content.bestPost.title}" with ${fmt(facts.content.bestPost.score)} interactions.`] : []),
      ...(facts.content.bestVideo ? [`Best reel/video: "${facts.content.bestVideo.title}" with ${fmt(facts.content.bestVideo.score)} interactions.`] : []),
      ...(info.best_content ? [info.best_content] : []),
    ],
    demographics_note: (() => {
      const dm = facts.demographics;
      if (!dm || !dm.hasData) return [];
      const lines = [];
      if (dm.cities.length) lines.push(`Top cities: ${dm.cities.map(c => `${c.name} ${c.pct}%`).join(', ')}.`);
      if (dm.ageRanges.length) {
        const top = [...dm.ageRanges].sort((a, b) => b.pct - a.pct)[0];
        lines.push(`Age groups: ${dm.ageRanges.map(a => `${a.range} ${a.pct}%`).join(', ')}. Largest group: ${top.range} (${top.pct}%).`);
      }
      if (dm.gender.female !== null || dm.gender.male !== null) lines.push(`Gender split: ${dm.gender.female !== null ? `Women ${dm.gender.female}%` : ''}${dm.gender.female !== null && dm.gender.male !== null ? ', ' : ''}${dm.gender.male !== null ? `Men ${dm.gender.male}%` : ''}.`);
      return lines;
    })(),
    ads_note: ads.enabled ? [
      ...(ads.spend !== null ? [`Total ad spend: ${money(ads.spend)}${ads.gst !== null ? ` + GST ${money(ads.gst)} = ${money(ads.spend + ads.gst)}` : ''}.`] : []),
      ...(ads.messages !== null || ads.calls !== null ? [`Messages: ${fmt(ads.messages || 0)}, calls: ${fmt(ads.calls || 0)}, total enquiries: ${fmt(ads.enquiries)}.`] : []),
      ...(ads.leads !== null ? [`Leads generated: ${fmt(ads.leads)}${ads.cpl !== null ? ` at ${money(ads.cpl)} per lead` : ''}.`] : []),
      ...(ads.ctr !== null ? [`Click-through rate: ${pct1(ads.ctr)}.`] : []),
    ] : [],
    activities: info.activities || '',
    worked, not_worked: notWorked, improvements, attention,
    rec_content: content, rec_formats: formats, rec_campaigns: campaignIdeas, rec_audience: audience, rec_ads: adRecs,
    plan_direction: direction,
    plan_deliverables: proposedDeliverables,
    plan_priorities: priorities,
    plan_targets: targets,
    plan_actions: actions,
    month_label: month,
  };
}

function buildAnalysis(inputs, prevInputs) {
  const facts = computeFacts(inputs, prevInputs);
  return { facts, narrative: buildNarrative(inputs, facts), generated_at: new Date().toISOString() };
}

module.exports = { buildAnalysis, computeFacts, buildNarrative, monthLabel, shiftMonth, platformLabel, METRICS, num, fmt, pct1, money };
