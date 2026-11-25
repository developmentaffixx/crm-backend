/**
 * SMM monthly report - 10-slide PPTX builder (pptxgenjs).
 * All charts and tables are native PowerPoint objects, so the deck stays editable.
 */
const PptxGenJS = require('pptxgenjs');
const { monthLabel, platformLabel, fmt, pct1, money } = require('./smmReportAnalysis');

const C = {
  dark: '5D3A1A', accent: 'C49A6C', light: 'F8F5F2', band: 'F0EDE8',
  text: '222222', gray: '666666', line: 'DDDDDD',
  good: '2E7D32', bad: 'C62828', neutral: '777777', white: 'FFFFFF',
};
const FONT = 'Arial';
const TOTAL = 10;

function deltaText(k) {
  if (!k || k.pct === null || k.prev === null || k.prev === undefined) return { text: 'No previous data', color: C.neutral };
  const arrow = k.direction === 'up' ? '▲' : k.direction === 'down' ? '▼' : '▬';
  const color = k.sentiment === 'positive' ? C.good : k.sentiment === 'negative' ? C.bad : C.neutral;
  return { text: `${arrow} ${Math.abs(k.pct).toFixed(1)}% vs prev`, color };
}

function build({ meta, facts, narrative, draft }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AffixxMedia';
  pptx.company = 'AffixxMedia';
  pptx.title = `${meta.clientName} - Social Media Report - ${monthLabel(meta.month)}`;

  const month = monthLabel(meta.month);
  const nextMonth = meta.nextMonthLabel;

  const header = (slide, title, n, subtitle) => {
    slide.background = { color: C.white };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: C.dark }, line: { color: C.dark } });
    slide.addText(title, { x: 0.5, y: 0.3, w: 9.8, h: 0.6, fontSize: 26, bold: true, color: C.dark, fontFace: FONT });
    if (subtitle) slide.addText(subtitle, { x: 0.5, y: 0.88, w: 9.8, h: 0.3, fontSize: 12, color: C.gray, fontFace: FONT });
    if (meta.affixxLogo) slide.addImage({ data: meta.affixxLogo, x: 10.5, y: 0.25, w: 1.4, h: 0.6, sizing: { type: 'contain', w: 1.4, h: 0.6 } });
    if (meta.clientLogo) slide.addImage({ data: meta.clientLogo, x: 12.0, y: 0.25, w: 0.9, h: 0.6, sizing: { type: 'contain', w: 0.9, h: 0.6 } });
    slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 7.0, w: 12.33, h: 0, line: { color: C.line, width: 0.75 } });
    slide.addText(`AffixxMedia  |  ${meta.clientName}  |  ${month}${draft ? '  |  DRAFT - NOT APPROVED' : ''}`, { x: 0.5, y: 7.05, w: 10, h: 0.3, fontSize: 9, color: draft ? C.bad : C.gray, fontFace: FONT });
    slide.addText(`${n} / ${TOTAL}`, { x: 11.8, y: 7.05, w: 1.0, h: 0.3, fontSize: 9, color: C.gray, align: 'right', fontFace: FONT });
  };

  const bullets = (items, opts = {}) => (items || []).filter(Boolean).map(t => ({
    text: String(t), options: { bullet: { indent: 14 }, breakLine: true, fontSize: opts.fontSize || 12, color: C.text, fontFace: FONT, paraSpaceAfter: 4 },
  }));

  const box = (slide, title, items, x, y, w, h, opts = {}) => {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: opts.fill || C.light }, line: { color: C.line, width: 0.75 } });
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h, fill: { color: opts.bar || C.accent }, line: { color: opts.bar || C.accent } });
    slide.addText(title, { x: x + 0.2, y: y + 0.08, w: w - 0.3, h: 0.35, fontSize: 13, bold: true, color: C.dark, fontFace: FONT });
    const list = (items || []).filter(Boolean);
    if (!list.length) {
      slide.addText('Nothing to report from the data entered.', { x: x + 0.2, y: y + 0.5, w: w - 0.3, h: h - 0.6, fontSize: 11, italic: true, color: C.gray, fontFace: FONT, valign: 'top' });
    } else {
      slide.addText(bullets(list, { fontSize: opts.fontSize || 11 }), { x: x + 0.2, y: y + 0.48, w: w - 0.3, h: h - 0.58, valign: 'top', fit: 'shrink' });
    }
  };

  const card = (slide, label, value, sub, subColor, x, y, w = 2.9, h = 1.15) => {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.light }, line: { color: C.line, width: 0.75 } });
    slide.addText(label.toUpperCase(), { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: 0.28, fontSize: 9, bold: true, color: C.gray, fontFace: FONT });
    slide.addText(String(value), { x: x + 0.15, y: y + 0.35, w: w - 0.3, h: 0.5, fontSize: 24, bold: true, color: C.dark, fontFace: FONT });
    slide.addText(sub || '', { x: x + 0.15, y: y + 0.85, w: w - 0.3, h: 0.25, fontSize: 9, color: subColor || C.gray, fontFace: FONT });
  };

  const th = (t, align) => ({ text: t, options: { bold: true, fontSize: 10, color: C.dark, fill: { color: C.band }, align: align || 'left', fontFace: FONT } });
  const td = (t, o = {}) => ({ text: String(t === null || t === undefined ? '-' : t), options: { fontSize: 10, color: C.text, fontFace: FONT, ...o } });
  const tableOpts = (extra) => ({ border: { type: 'solid', color: C.line, pt: 0.75 }, ...extra });
  const chartBase = { showLegend: true, legendPos: 'b', legendFontSize: 10, catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, chartColors: [C.dark, C.accent, '8D6E63', 'BCAAA4'], showTitle: false };

  const kpi = (key) => facts.kpis.find(k => k.key === key);
  const activePlatforms = facts.platforms.filter(p => p.hasData);

  // 1 ─ Cover / overview
  {
    const s = pptx.addSlide();
    s.background = { color: C.light };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.35, fill: { color: C.dark }, line: { color: C.dark } });
    if (meta.affixxLogo) s.addImage({ data: meta.affixxLogo, x: 0.6, y: 0.6, w: 2.0, h: 0.8, sizing: { type: 'contain', w: 2.0, h: 0.8 } });
    else s.addText('AffixxMedia', { x: 0.6, y: 0.6, w: 3, h: 0.6, fontSize: 20, bold: true, color: C.dark, fontFace: FONT });
    if (meta.clientLogo) s.addImage({ data: meta.clientLogo, x: 10.7, y: 0.6, w: 2.0, h: 0.9, sizing: { type: 'contain', w: 2.0, h: 0.9 } });
    s.addText('MONTHLY SOCIAL MEDIA PERFORMANCE REPORT', { x: 0.6, y: 1.9, w: 12, h: 0.4, fontSize: 14, bold: true, color: C.accent, fontFace: FONT, charSpacing: 3 });
    s.addText(meta.clientName, { x: 0.6, y: 2.3, w: 12, h: 0.9, fontSize: 40, bold: true, color: C.dark, fontFace: FONT });
    s.addText(month, { x: 0.6, y: 3.2, w: 6, h: 0.5, fontSize: 22, color: C.text, fontFace: FONT });
    s.addText(`Platforms managed: ${meta.platforms.map(platformLabel).join(', ') || '-'}`, { x: 0.6, y: 3.75, w: 12, h: 0.35, fontSize: 13, color: C.gray, fontFace: FONT });
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.4, w: 12.1, h: 2.1, fill: { color: C.white }, line: { color: C.line, width: 0.75 } });
    s.addText('Monthly account overview', { x: 0.8, y: 4.48, w: 11, h: 0.35, fontSize: 13, bold: true, color: C.dark, fontFace: FONT });
    s.addText(narrative.overview || 'No overview generated.', { x: 0.8, y: 4.85, w: 11.7, h: 1.6, fontSize: 12, color: C.text, fontFace: FONT, valign: 'top', fit: 'shrink' });
    s.addText(`${draft ? 'DRAFT - pending approval  |  ' : ''}Prepared by AffixxMedia`, { x: 0.6, y: 6.9, w: 12, h: 0.3, fontSize: 10, color: draft ? C.bad : C.gray, fontFace: FONT });
  }

  // 2 ─ Deliverables
  {
    const s = pptx.addSlide();
    const d = facts.deliverables;
    header(s, 'Monthly Deliverables Summary', 2, `Planned versus completed, ${month}`);
    card(s, 'Completion', d.pct === null ? '-' : pct1(d.pct), d.plannedTotal ? `${d.completedTotal} of ${d.plannedTotal} delivered` : '', C.gray, 0.5, 1.3, 2.4);
    if (d.rows.length) {
      s.addChart(pptx.charts.BAR, [
        { name: 'Planned', labels: d.rows.map(r => r.type), values: d.rows.map(r => r.planned || 0) },
        { name: 'Completed', labels: d.rows.map(r => r.type), values: d.rows.map(r => r.completed || 0) },
      ], { ...chartBase, x: 3.1, y: 1.3, w: 5.0, h: 3.0, barDir: 'col', barGrouping: 'clustered', showValue: true, dataLabelFontSize: 9 });
      const rows = [[th('Deliverable'), th('Planned', 'center'), th('Completed', 'center'), th('Pending', 'center'), th('Completion', 'center')]];
      d.rows.forEach(r => rows.push([td(r.type, { bold: true }), td(r.planned ?? '-', { align: 'center' }), td(r.completed ?? '-', { align: 'center' }), td(r.pending ?? '-', { align: 'center' }), td(r.pct === null ? '-' : pct1(r.pct), { align: 'center', bold: true, color: r.pct !== null && r.pct < 90 ? C.bad : C.good })]));
      rows.push([td('Total', { bold: true, fill: { color: C.band } }), td(d.plannedTotal, { align: 'center', bold: true, fill: { color: C.band } }), td(d.completedTotal, { align: 'center', bold: true, fill: { color: C.band } }), td(Math.max(d.plannedTotal - d.completedTotal, 0), { align: 'center', bold: true, fill: { color: C.band } }), td(d.pct === null ? '-' : pct1(d.pct), { align: 'center', bold: true, fill: { color: C.band } })]);
      s.addTable(rows, tableOpts({ x: 8.3, y: 1.3, w: 4.55, colW: [1.35, 0.8, 0.9, 0.7, 0.8], rowH: 0.3 }));
    }
    box(s, 'Summary', narrative.deliverables_summary, 0.5, 4.5, 6.0, 2.35);
    box(s, 'Pending deliverables and reasons', d.pendingItems.map(p => `${p.item || 'Item'}${p.reason ? ' - ' + p.reason : ''}`), 6.7, 4.5, 6.15, 2.35, { bar: C.bad });
  }

  // 3 ─ Overall performance
  {
    const s = pptx.addSlide();
    header(s, 'Overall Performance Overview', 3, facts.hasPrevious ? `Compared with ${monthLabel(facts.previousMonth)}` : 'No previous month on record');
    const keys = ['reach', 'impressions', 'engagement', 'followers_gained', 'profile_visits', 'link_clicks', 'video_views'];
    const cards = keys.map(kpi).filter(k => k && k.value !== null);
    cards.slice(0, 7).forEach((k, i) => {
      const d = deltaText(k);
      card(s, k.label, fmt(k.value), d.text, d.color, 0.5 + (i % 4) * 3.1, 1.3 + Math.floor(i / 4) * 1.3);
    });
    if (facts.engagementRate !== null) {
      const dr = facts.engagementRateChange;
      const t = dr && dr.pct !== null ? `${dr.direction === 'up' ? '▲' : dr.direction === 'down' ? '▼' : '▬'} from ${pct1(facts.prevEngagementRate)}` : 'Engagement / reach';
      card(s, 'Engagement rate', pct1(facts.engagementRate), t, dr && dr.sentiment === 'positive' ? C.good : dr && dr.sentiment === 'negative' ? C.bad : C.gray, 0.5 + (cards.length % 4) * 3.1, 1.3 + Math.floor(Math.min(cards.length, 7) / 4) * 1.3);
    }
    const chartKpis = ['reach', 'impressions', 'engagement'].map(kpi).filter(k => k && k.value !== null);
    if (chartKpis.length) {
      const series = [{ name: month, labels: chartKpis.map(k => k.label), values: chartKpis.map(k => k.value) }];
      if (facts.hasPrevious && chartKpis.some(k => k.prev !== null)) series.unshift({ name: monthLabel(facts.previousMonth), labels: chartKpis.map(k => k.label), values: chartKpis.map(k => k.prev || 0) });
      s.addChart(pptx.charts.BAR, series, { ...chartBase, x: 0.5, y: 4.0, w: 6.4, h: 2.9, barDir: 'col', barGrouping: 'clustered', showValue: true, dataLabelFontSize: 8, dataLabelFormatCode: '#,##0' });
    }
    box(s, 'Key observations', narrative.performance_note.length ? narrative.performance_note : ['Only one month of data is available, so no trend can be reported yet.'], 7.1, 4.0, 5.75, 2.9);
  }

  // 4 ─ Platform-wise
  {
    const s = pptx.addSlide();
    header(s, 'Platform-Wise Performance', 4, 'Individual platform comparison');
    if (!activePlatforms.length) {
      s.addText('No platform metrics were entered.', { x: 0.5, y: 1.5, w: 12, h: 0.5, fontSize: 14, italic: true, color: C.gray, fontFace: FONT });
    } else {
      const rowsDef = [['reach', 'Reach'], ['impressions', 'Impressions'], ['engagement', 'Engagement'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares'], ['saves', 'Saves'], ['followers_gained', 'Followers gained'], ['profile_visits', 'Profile visits'], ['link_clicks', 'Link clicks'], ['video_views', 'Video views']]
        .filter(([k]) => activePlatforms.some(p => p.metrics[k] !== null));
      const colW = 2.0; const labelW = 1.9;
      const rows = [[th('Metric'), ...activePlatforms.map(p => th(p.label, 'center'))]];
      rowsDef.forEach(([k, label]) => rows.push([td(label, { bold: true }), ...activePlatforms.map((p) => {
        const c = p.changes && p.changes[k];
        const arrow = c && c.direction === 'up' ? ' ▲' : c && c.direction === 'down' ? ' ▼' : '';
        const color = c && c.sentiment === 'positive' ? C.good : c && c.sentiment === 'negative' ? C.bad : C.text;
        return td(p.metrics[k] === null ? '-' : fmt(p.metrics[k]) + arrow, { align: 'center', color });
      })]));
      rows.push([td('Engagement rate', { bold: true, fill: { color: C.band } }), ...activePlatforms.map(p => td(p.engagementRate === null ? '-' : pct1(p.engagementRate), { align: 'center', bold: true, fill: { color: C.band } }))]);
      s.addTable(rows, tableOpts({ x: 0.5, y: 1.3, w: labelW + colW * activePlatforms.length, colW: [labelW, ...activePlatforms.map(() => colW)], rowH: 0.3 }));
      const tableW = labelW + colW * activePlatforms.length;
      if (tableW < 8.5) {
        const cm = ['reach', 'impressions', 'engagement'].filter(k => activePlatforms.some(p => p.metrics[k] !== null));
        s.addChart(pptx.charts.BAR, activePlatforms.map(p => ({ name: p.label, labels: cm.map(k => k[0].toUpperCase() + k.slice(1)), values: cm.map(k => p.metrics[k] || 0) })),
          { ...chartBase, x: tableW + 0.7, y: 1.3, w: 12.83 - tableW - 0.7, h: 3.2, barDir: 'col', barGrouping: 'clustered', dataLabelFormatCode: '#,##0' });
      }
      if (narrative.platform_note.length) s.addText(narrative.platform_note.join(' '), { x: 0.5, y: 6.3, w: 12.3, h: 0.6, fontSize: 11, color: C.text, fontFace: FONT, valign: 'top' });
    }
  }

  // 5 ─ Audience growth & engagement
  {
    const s = pptx.addSlide();
    header(s, 'Audience Growth & Engagement', 5, 'Followers, interactions and profile activity');
    [['followers_gained', 'Followers gained'], ['profile_visits', 'Profile visits'], ['link_clicks', 'Link clicks']].forEach(([key, label], i) => {
      const k = kpi(key);
      const d = deltaText(k);
      card(s, label, k && k.value !== null ? fmt(k.value) : '-', d.text, d.color, 0.5 + i * 4.15, 1.3, 3.95);
    });
    const inter = ['likes', 'comments', 'shares', 'saves'].map(kpi).filter(k => k && k.value !== null);
    if (inter.length) {
      const series = [{ name: month, labels: inter.map(k => k.label), values: inter.map(k => k.value) }];
      if (facts.hasPrevious && inter.some(k => k.prev !== null)) series.unshift({ name: monthLabel(facts.previousMonth), labels: inter.map(k => k.label), values: inter.map(k => k.prev || 0) });
      s.addChart(pptx.charts.BAR, series, { ...chartBase, x: 0.5, y: 2.7, w: 7.0, h: 4.1, barDir: 'col', barGrouping: 'clustered', showValue: true, dataLabelFontSize: 8, dataLabelFormatCode: '#,##0' });
    }
    const interaction = [...narrative.audience_note, ...(facts.engagementRate !== null ? [`Engagement rate: ${pct1(facts.engagementRate)} of reach.`] : [])];
    const demo = narrative.demographics_note || [];
    if (demo.length) {
      box(s, 'Audience interaction', interaction, 7.7, 2.7, 5.15, 1.7);
      box(s, 'Audience demographics', demo, 7.7, 4.5, 5.15, 2.3, { fontSize: 10 });
    } else {
      box(s, 'Audience interaction', interaction, 7.7, 2.7, 5.15, 4.1);
    }
  }

  // 6 ─ Top content
  {
    const s = pptx.addSlide();
    header(s, 'Top-Performing Content', 6, 'Ranked by total interactions');
    const items = facts.content.items.slice(0, 6);
    if (!items.length) {
      s.addText('No content performance entries were added.', { x: 0.5, y: 1.5, w: 12, h: 0.5, fontSize: 14, italic: true, color: C.gray, fontFace: FONT });
    } else {
      const rows = [[th('#', 'center'), th('Content'), th('Platform'), th('Format'), th('Reach', 'center'), th('Likes', 'center'), th('Comments', 'center'), th('Shares', 'center'), th('Saves', 'center'), th('Interactions', 'center')]];
      items.forEach((i, idx) => rows.push([td(idx + 1, { align: 'center', bold: true }), td(i.title, { bold: true }), td(i.platform ? platformLabel(i.platform.toLowerCase()) : '-'), td(i.format), td(fmt(i.reach), { align: 'center' }), td(fmt(i.likes), { align: 'center' }), td(fmt(i.comments), { align: 'center' }), td(fmt(i.shares), { align: 'center' }), td(fmt(i.saves), { align: 'center' }), td(fmt(i.score), { align: 'center', bold: true })]));
      s.addTable(rows, tableOpts({ x: 0.5, y: 1.3, w: 12.35, colW: [0.4, 3.6, 1.3, 1.1, 1.0, 0.9, 1.0, 0.9, 0.8, 1.35], rowH: 0.35 }));
    }
    // Screenshots of the best content (up to 3) sit left of the observations.
    const shots = (meta.contentImages || []).filter(x => x && x.data).slice(0, 3);
    if (shots.length) {
      shots.forEach((img, i) => {
        const x = 0.5 + i * 1.95;
        s.addImage({ data: img.data, x, y: 4.5, w: 1.8, h: 2.05, sizing: { type: 'contain', w: 1.8, h: 2.05 } });
        s.addText(`#${img.rank}`, { x, y: 6.55, w: 1.8, h: 0.3, fontSize: 9, bold: true, color: C.dark, align: 'center', fontFace: FONT });
      });
      box(s, 'Key observations', narrative.content_notes, 6.5, 4.5, 6.35, 2.35);
    } else {
      box(s, 'Key observations', narrative.content_notes, 0.5, 4.5, 12.35, 2.35);
    }
  }

  // 7 ─ Ads
  {
    const s = pptx.addSlide();
    const a = facts.ads;
    header(s, 'Advertisement Performance', 7, a.enabled ? 'Paid campaign results' : 'Not applicable this month');
    if (!a.enabled) {
      s.addText('Advertising services were not part of this month\'s scope, so there is no ad performance to report.', { x: 0.8, y: 2.5, w: 11.5, h: 1.2, fontSize: 18, color: C.gray, align: 'center', fontFace: FONT });
    } else {
      const ch = a.changes || {};
      const cards = [
        ['Ad spend', a.spend === null ? '-' : money(a.spend), ch.spend ? deltaText(ch.spend) : null],
        ['Leads', fmt(a.leads), ch.leads ? deltaText(ch.leads) : null],
        ['Cost per lead', a.cpl === null ? '-' : money(a.cpl), ch.cpl ? deltaText(ch.cpl) : null],
        ['Click-through rate', a.ctr === null ? '-' : pct1(a.ctr), ch.ctr ? deltaText(ch.ctr) : null],
        ['Reach', fmt(a.reach), null], ['Impressions', fmt(a.impressions), null],
        ['Clicks', fmt(a.clicks), null], ['Conversions', fmt(a.conversions), ch.conversions ? deltaText(ch.conversions) : null],
      ];
      cards.forEach(([label, value, d], i) => card(s, label, value, d ? d.text : '', d ? d.color : C.gray, 0.5 + (i % 4) * 3.1, 1.3 + Math.floor(i / 4) * 1.25, 2.95, 1.1));
      if (a.campaigns.length) {
        const rows = [[th('Campaign'), th('Spend', 'center'), th('Reach', 'center'), th('Clicks', 'center'), th('Leads', 'center'), th('Cost / lead', 'center')]];
        a.campaigns.slice(0, 5).forEach(c => rows.push([td(c.name, { bold: true }), td(c.spend === null ? '-' : money(c.spend), { align: 'center' }), td(fmt(c.reach), { align: 'center' }), td(fmt(c.clicks), { align: 'center' }), td(fmt(c.leads), { align: 'center' }), td(c.cpl === null ? '-' : money(c.cpl), { align: 'center' })]));
        s.addTable(rows, tableOpts({ x: 0.5, y: 3.95, w: 7.6, colW: [2.4, 1.0, 1.0, 0.9, 0.9, 1.4], rowH: 0.32 }));
      }
      box(s, 'Observations', narrative.ads_note, 8.3, 3.95, 4.55, 2.9);
    }
  }

  // 8 ─ Analysis
  {
    const s = pptx.addSlide();
    header(s, 'Monthly Analysis & Key Findings', 8, 'Derived from the metrics entered this month');
    box(s, 'What worked well', narrative.worked, 0.5, 1.3, 6.1, 2.75, { bar: C.good });
    box(s, 'What did not work', narrative.not_worked, 6.75, 1.3, 6.1, 2.75, { bar: C.bad });
    box(s, 'Performance improvements', narrative.improvements, 0.5, 4.2, 6.1, 2.65, { bar: C.accent });
    box(s, 'Areas requiring attention', narrative.attention, 6.75, 4.2, 6.1, 2.65, { bar: 'F9A825' });
  }

  // 9 ─ Recommendations
  {
    const s = pptx.addSlide();
    header(s, `Strategy & Recommendations for ${nextMonth}`, 9, 'Each recommendation cites the data it is based on');
    box(s, 'Content improvements', narrative.rec_content, 0.5, 1.3, 6.1, 1.8, { fontSize: 10 });
    box(s, 'Recommended content formats', narrative.rec_formats, 6.75, 1.3, 6.1, 1.8, { fontSize: 10 });
    box(s, 'Campaign ideas', narrative.rec_campaigns, 0.5, 3.25, 6.1, 1.8, { fontSize: 10 });
    box(s, 'Audience growth strategies', narrative.rec_audience, 6.75, 3.25, 6.1, 1.8, { fontSize: 10 });
    if (facts.ads.enabled) box(s, 'Advertisement recommendations', narrative.rec_ads, 0.5, 5.2, 12.35, 1.65, { fontSize: 10 });
    else box(s, 'Advertisement recommendations', ['Not applicable: advertising is not part of the current service scope.'], 0.5, 5.2, 12.35, 1.65, { fontSize: 10 });
  }

  // 10 ─ Action plan
  {
    const s = pptx.addSlide();
    header(s, `${nextMonth} Action Plan`, 10, narrative.plan_direction);
    const rowsD = [[th('Proposed deliverable'), th('Count', 'center'), th('Note')]];
    narrative.plan_deliverables.forEach(r => rowsD.push([td(r.type, { bold: true }), td(r.proposed, { align: 'center', bold: true }), td(r.note)]));
    s.addText('Proposed deliverables', { x: 0.5, y: 1.25, w: 6, h: 0.3, fontSize: 13, bold: true, color: C.dark, fontFace: FONT });
    if (narrative.plan_deliverables.length) s.addTable(rowsD, tableOpts({ x: 0.5, y: 1.6, w: 6.1, colW: [2.2, 0.8, 3.1], rowH: 0.3 }));
    const rowsT = [[th('Target metric'), th('Current', 'center'), th('Target', 'center'), th('Basis')]];
    narrative.plan_targets.forEach(r => rowsT.push([td(r.metric, { bold: true }), td(fmt(r.current), { align: 'center' }), td(fmt(r.target), { align: 'center', bold: true }), td(r.basis)]));
    s.addText('Performance improvement targets', { x: 6.75, y: 1.25, w: 6, h: 0.3, fontSize: 13, bold: true, color: C.dark, fontFace: FONT });
    if (narrative.plan_targets.length) s.addTable(rowsT, tableOpts({ x: 6.75, y: 1.6, w: 6.1, colW: [1.6, 0.8, 0.8, 2.9], rowH: 0.3 }));
    box(s, 'Strategic priorities', narrative.plan_priorities, 0.5, 4.5, 6.1, 2.35);
    box(s, 'Key action items', narrative.plan_actions, 6.75, 4.5, 6.1, 2.35);
  }

  return pptx;
}

async function toBuffer(args) {
  return build(args).write({ outputType: 'nodebuffer' });
}

module.exports = { toBuffer };
