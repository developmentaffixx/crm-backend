/**
 * Generates the HTML for pitch deck PDF - matches the viewer UI exactly
 */
module.exports = function buildPdfHtml({ deck, painPoints, gaps, opps, goals, plans, opportunityStats, whyUs, ctaSteps, bg, logo }) {
  const cn = deck.company_name || '';
  const now = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  let slides = '';

  // Slide 1: Title
  slides += `<div class="s" style="background-image:url(${bg})">
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:50px 10%;position:relative;margin-top:-36px">
      ${logo ? `<img src="${logo}" style="height:128px;object-fit:contain;margin-bottom:40px"/>` : ''}
      <h1 style="font-family:'Poppins',sans-serif;font-size:51px;font-weight:700;color:#3b2314;line-height:1.2;margin-bottom:12px">${deck.title || cn}</h1>
      <p style="font-family:'Merriweather',serif;font-size:16px;color:#7a5c4a;font-style:italic">For ${deck.lead_name || 'Client'}${deck.lead_business_name ? ', ' + deck.lead_business_name : ''}</p>
      <div style="position:absolute;bottom:36px;left:0;right:0;text-align:center;font-family:'Karla',sans-serif;font-size:12px;color:#9c8070;letter-spacing:.5px">Presented by ${cn} ${deck.contact_website ? '• ' + deck.contact_website : ''} • ${now}</div>
    </div>
  </div>`;

  // Slide 2: Opportunity
  if (opportunityStats.length) {
    slides += `<div class="s" style="display:flex">
      <div style="width:38%;height:100%;background:#3b2314;display:flex;flex-direction:column;justify-content:center;padding:0 5%">
        <h2 style="font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:16px">YOUR<br>OPPORTUNITY</h2>
        ${deck.opportunity_intro ? `<p style="font-family:'Merriweather',serif;font-size:12.8px;color:rgba(255,255,255,.7);font-style:italic;line-height:1.6">${deck.opportunity_intro}</p>` : ''}
      </div>
      <div style="width:62%;height:100%;background-image:url(${bg});background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:0 5%;position:relative">
        ${logo ? `<img src="${logo}" style="height:56px;object-fit:contain;position:absolute;top:5%;right:5%"/>` : ''}
        ${opportunityStats.map(s => `<div style="background:#fff;border-radius:12px;padding:16px;border:1px solid #e5e7eb"><p style="font-family:'Poppins',sans-serif;font-size:28px;font-weight:700;color:#3b2314;margin-bottom:4px">${s.value}</p><p style="font-family:'Karla',sans-serif;font-size:12px;color:#6b4c3b">${s.label}</p></div>`).join('')}
      </div>
    </div>`;
  }

  // Slide 3: Research & Insights
  if (painPoints.length || gaps.length || opps.length) {
    slides += `<div class="s" style="background-image:url(${bg})">
      <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:40px 50px">
        <div style="margin-bottom:16px">${logo ? `<img src="${logo}" style="height:48px;object-fit:contain"/>` : ''}</div>
        <h2 style="font-family:'Poppins',sans-serif;font-size:30px;font-weight:700;color:#3b2314;margin-bottom:16px">Research & Insights</h2>
        <div style="display:flex;gap:16px;align-items:flex-start">
          <div style="flex:1;background:#fff;border-radius:16px;padding:12px;border:1px solid #e5e7eb">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="width:24px;height:24px;border-radius:8px;background:#8b4513;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-size:10px;font-weight:700">!</span></div><span style="font-family:'Poppins',sans-serif;font-size:10px;font-weight:700;color:#3b2314;text-transform:uppercase;letter-spacing:.5px">Pain Points</span></div>
            ${painPoints.map(p => `<p style="font-family:'Karla',sans-serif;font-size:10px;color:#5c4033;margin-bottom:6px;line-height:1.4;display:flex;align-items:flex-start;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#8b4513;margin-top:4px;flex-shrink:0"></span>${p.content}</p>`).join('')}
          </div>
          <div style="flex:1;background:#fff;border-radius:16px;padding:12px;border:1px solid #e5e7eb">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="width:24px;height:24px;border-radius:8px;background:#a0522d;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-size:10px;font-weight:700">⚡</span></div><span style="font-family:'Poppins',sans-serif;font-size:10px;font-weight:700;color:#3b2314;text-transform:uppercase;letter-spacing:.5px">Identified Gaps</span></div>
            ${gaps.map(g => `<p style="font-family:'Karla',sans-serif;font-size:10px;color:#5c4033;margin-bottom:6px;line-height:1.4;display:flex;align-items:flex-start;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#a0522d;margin-top:4px;flex-shrink:0"></span>${g.content}</p>`).join('')}
          </div>
          <div style="flex:1;background:#fff;border-radius:16px;padding:12px;border:1px solid #e5e7eb">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="width:24px;height:24px;border-radius:8px;background:#2e4a3e;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-size:10px;font-weight:700">↗</span></div><span style="font-family:'Poppins',sans-serif;font-size:10px;font-weight:700;color:#3b2314;text-transform:uppercase;letter-spacing:.5px">Opportunities</span></div>
            ${opps.map(o => `<p style="font-family:'Karla',sans-serif;font-size:10px;color:#5c4033;margin-bottom:6px;line-height:1.4;display:flex;align-items:flex-start;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#2e4a3e;margin-top:4px;flex-shrink:0"></span>${o.content}</p>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  // Slide 4: 90-Day Goals
  if (goals.length) {
    slides += `<div class="s" style="background-image:url(${bg})">
      <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:40px 50px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">${logo ? `<img src="${logo}" style="height:48px;object-fit:contain"/>` : ''}<span style="font-family:'Karla',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#9c8070">Roadmap</span></div>
        <h2 style="font-family:'Poppins',sans-serif;font-size:30px;font-weight:700;color:#3b2314;margin-bottom:16px">90-Day Goals</h2>
        <div style="display:flex;gap:16px;align-items:flex-start">
          ${[1,2,3].map(m => {
            const mg = goals.filter(g => g.month === m);
            return `<div style="flex:1;background:#fff;border-radius:16px;padding:12px;border:1px solid #e5e7eb">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-family:'Poppins',sans-serif;font-size:18px;font-weight:700;color:#3b2314">0${m}</span><span style="font-family:'Karla',sans-serif;font-size:12px;font-weight:700;color:#7a5c4a">Month ${m}</span></div>
              ${mg.map((g,i) => `<p style="font-family:'Karla',sans-serif;font-size:10px;color:#5c4033;margin-bottom:6px;line-height:1.4;display:flex;align-items:flex-start;gap:8px"><span style="width:16px;height:16px;border-radius:50%;background:#8b4513;color:#fff;font-size:8px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>${g.goal}</p>`).join('')}
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:12px;background:#fff;border-radius:8px;padding:8px 16px;border:1px solid #e5e7eb;font-family:'Karla',sans-serif;font-size:12px;color:#5c4033">Total: <strong style="color:#3b2314">${goals.length} goals across 3 months</strong></div>
      </div>
    </div>`;
  }

  // Slide 5: Business Model (Plans without pricing)
  if (plans.length) {
    slides += `<div class="s" style="background-image:url(${bg})">
      <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:40px 50px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">${logo ? `<img src="${logo}" style="height:48px;object-fit:contain"/>` : ''}<span style="font-family:'Karla',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#9c8070">Our Plans</span></div>
        <h2 style="font-family:'Poppins',sans-serif;font-size:30px;font-weight:700;color:#3b2314;margin-bottom:16px">Business Model</h2>
        <div style="display:flex;gap:16px;align-items:flex-start">
          ${plans.map(p => `<div style="flex:1;background:#fff;border-radius:16px;padding:12px;border:1px solid #e5e7eb">
            <h3 style="font-family:'Poppins',sans-serif;font-size:11px;font-weight:700;color:#3b2314;margin-bottom:2px">${p.name}</h3>
            <p style="font-family:'Karla',sans-serif;font-size:9px;color:#9c8070;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${p.service_name}</p>
            ${(p.features||[]).slice(0,5).map(f => `<p style="font-family:'Karla',sans-serif;font-size:9px;color:#5c4033;margin-bottom:4px"><span style="width:4px;height:4px;border-radius:50%;background:#8b4513;display:inline-block;margin-right:6px;vertical-align:middle"></span>${f.feature}</p>`).join('')}
          </div>`).join('')}
        </div>
      </div>
    </div>`;
  }

  // Slide 6: Pricing Plans
  if (plans.length) {
    slides += `<div class="s" style="background-image:url(${bg})">
      <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:40px 50px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">${logo ? `<img src="${logo}" style="height:48px;object-fit:contain"/>` : ''}<span style="font-family:'Karla',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#9c8070">Investment</span></div>
        <h2 style="font-family:'Poppins',sans-serif;font-size:30px;font-weight:700;color:#3b2314;margin-bottom:16px">Pricing Plans</h2>
        <div style="display:flex;gap:16px;align-items:flex-start">
          ${plans.map(p => `<div style="flex:1;background:#fff;border-radius:16px;padding:12px;border:${p.is_popular ? '2px solid #3b2314' : '1px solid #e5e7eb'}">
            <h3 style="font-family:'Poppins',sans-serif;font-size:11px;font-weight:700;color:#3b2314;margin-bottom:2px">${p.name}</h3>
            <p style="font-family:'Karla',sans-serif;font-size:9px;color:#9c8070;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${p.service_name}</p>
            ${(p.features||[]).slice(0,5).map(f => `<p style="font-family:'Karla',sans-serif;font-size:9px;color:#5c4033;margin-bottom:4px"><span style="color:#8b4513">✓</span> ${f.feature}</p>`).join('')}
            ${parseFloat(p.price)>0 ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb"><p style="font-family:'Poppins',sans-serif;font-size:18px;font-weight:700;color:#3b2314">₹${parseFloat(p.price).toLocaleString()} <span style="font-size:9px;font-weight:400;color:#9c8070">/${p.duration}</span></p></div>` : ''}
          </div>`).join('')}
        </div>
      </div>
    </div>`;
  }

  // Slide 6: Why Partner With Us
  if (whyUs.length) {
    const w = whyUs.length <= 4 ? 'calc(50% - 6px)' : 'calc(33.33% - 8px)';
    slides += `<div class="s" style="background-image:url(${bg})">
      <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:40px 50px">
        <div style="margin-bottom:16px">${logo ? `<img src="${logo}" style="height:48px;object-fit:contain"/>` : ''}</div>
        <h2 style="font-family:'Poppins',sans-serif;font-size:24px;font-weight:700;color:#3b2314;text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">Why Partner With Us</h2>
        <div style="display:flex;flex-wrap:wrap;gap:12px">
          ${whyUs.map(u => `<div style="width:${w};background:#fff;border-radius:12px;padding:12px;border:1px solid #e5e7eb">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:20px;height:20px;border-radius:50%;background:#3b2314;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-size:9px">✓</span></div><span style="font-family:'Poppins',sans-serif;font-size:10px;font-weight:700;color:#3b2314">${u.title}</span></div>
            <p style="font-family:'Karla',sans-serif;font-size:9px;color:#5c4033;line-height:1.5;padding-left:28px">${u.description}</p>
          </div>`).join('')}
        </div>
      </div>
    </div>`;
  }

  // Slide 7: Thank You
  slides += `<div class="s" style="background-image:url(${bg})">
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:50px 10%">
      ${logo ? `<img src="${logo}" style="height:128px;object-fit:contain;margin-bottom:32px"/>` : ''}
      <h1 style="font-family:'Poppins',sans-serif;font-size:45px;font-weight:700;color:#3b2314;margin-bottom:8px">${deck.cta_title || 'THANK YOU'}</h1>
      <p style="font-family:'Merriweather',serif;font-size:13.6px;color:#7a5c4a;font-style:italic;max-width:500px;line-height:1.6;margin-bottom:24px">${deck.cta_subtitle || deck.thanks_message || ''}</p>
      ${ctaSteps.length ? `<div style="text-align:left;margin-bottom:24px">${ctaSteps.map((s,i) => `<p style="font-family:'Karla',sans-serif;font-size:11px;color:#5c4033;margin-bottom:4px">${i+1}) ${s}</p>`).join('')}</div>` : ''}
      <div style="margin-top:8px">
        ${deck.contact_name ? `<p style="font-family:'Poppins',sans-serif;font-size:14px;font-weight:700;color:#3b2314;margin-bottom:4px">${deck.contact_name}</p>` : ''}
        <p style="font-family:'Karla',sans-serif;font-size:11px;color:#7a5c4a">${[deck.contact_phone, deck.contact_email].filter(Boolean).join(' • ')}</p>
        ${deck.contact_website ? `<p style="font-family:'Karla',sans-serif;font-size:11px;color:#8b4513;font-weight:600;margin-top:4px">${deck.contact_website}</p>` : ''}
      </div>
    </div>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Poppins:wght@600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:1280px 720px;margin:0}
body{font-family:'Karla',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.s{width:1280px;height:720px;position:relative;overflow:hidden;page-break-after:always;background-size:cover;background-position:center}
.s:last-child{page-break-after:auto}
</style></head><body>${slides}</body></html>`;
};
