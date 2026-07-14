// Report renderer — turns analysis + narrative into the Profit Truth Report page.
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
  :root{--ink:#141a24;--ink-2:#333d4d;--navy:#16324f;--green:#0e7a4e;--green-soft:#e8f4ee;
  --red:#a33327;--amber:#b7791f;--amber-soft:#fdf6e9;--line:#d8dee6;--paper:#fff;--wash:#f5f7f9;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:"Segoe UI",-apple-system,Arial,sans-serif;color:var(--ink);background:var(--wash);line-height:1.55;font-size:16px;}
  .page{max-width:860px;margin:0 auto;background:var(--paper);padding:56px 64px 72px;}
  header{border-bottom:3px solid var(--navy);padding-bottom:24px;margin-bottom:32px;}
  .kicker{text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px;}
  .kicker a{color:inherit;text-decoration:none;}
  h1{font-family:Georgia,serif;font-size:34px;line-height:1.15;color:var(--navy);margin-bottom:8px;}
  .meta{font-size:14px;color:var(--ink-2);}
  h2{font-family:Georgia,serif;font-size:22px;color:var(--navy);margin:40px 0 12px;}
  p{margin-bottom:12px;}
  .headline{background:var(--navy);color:#fff;padding:26px 30px;border-radius:6px;margin:24px 0;font-family:Georgia,serif;font-size:19px;line-height:1.5;}
  .statrow{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0;}
  .stat{border:1px solid var(--line);border-radius:6px;padding:14px 16px;}
  .stat .n{font-size:23px;font-weight:700;color:var(--navy);}
  .stat .l{font-size:13px;color:var(--ink-2);}
  table{width:100%;border-collapse:collapse;margin:14px 0 8px;font-size:15px;}
  th{text-align:left;background:var(--navy);color:#fff;padding:9px 12px;font-weight:600;}
  td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:middle;}
  .bar-holder{background:var(--wash);border-radius:4px;height:16px;width:100%;min-width:110px;}
  .bar{height:16px;border-radius:4px;background:var(--green);}
  .bar.low{background:var(--red);} .bar.mid{background:var(--amber);}
  .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
  .finding{border:1px solid var(--line);border-left:5px solid var(--red);border-radius:6px;padding:16px 20px;margin:14px 0;}
  .finding.win{border-left-color:var(--green);} .finding.cash{border-left-color:var(--amber);}
  .finding h3{font-size:16px;color:var(--navy);margin-bottom:6px;}
  .finding .worth{display:inline-block;font-size:13px;font-weight:700;color:var(--green);background:var(--green-soft);padding:2px 10px;border-radius:12px;margin-top:6px;}
  .finding p{margin-bottom:6px;}
  .action{font-weight:600;}
  .method{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--ink-2);}
  .spin{margin:80px auto;text-align:center;font-family:Georgia,serif;}
  .spin .dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--green);margin:0 4px;animation:b 1.2s infinite;}
  .spin .dot:nth-child(2){animation-delay:.2s;} .spin .dot:nth-child(3){animation-delay:.4s;}
  @keyframes b{0%,80%,100%{opacity:.25}40%{opacity:1}}
  @media (max-width:720px){.page{padding:28px 20px;}.statrow{grid-template-columns:1fr 1fr;}}
`;

function shell(title, body, extraHead = '') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>${extraHead}<style>${CSS}</style></head><body>${body}</body></html>`;
}

function renderPending(reportId) {
  return shell('Reading your numbers… — Profit Lab', `
    <div class="page"><div class="spin">
      <h1>Reading your numbers&hellip;</h1>
      <p style="color:var(--ink-2);max-width:460px;margin:14px auto;">Profit Lab is pulling your jobs, visits, and invoices and computing what every hour actually earns. This usually takes under a minute. This page refreshes itself.</p>
      <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div></div>`,
    `<meta http-equiv="refresh" content="6">`);
}

function renderError(message) {
  return shell('Something went wrong — Profit Lab', `
    <div class="page"><h1 style="margin-top:40px;">We hit a snag reading your account.</h1>
    <p style="color:var(--ink-2);">${esc(message || 'The connection to Jobber did not complete.')}</p>
    <p><a href="/connect" style="color:var(--green);font-weight:700;">Try connecting again</a> &nbsp;&middot;&nbsp; <a href="/" style="color:var(--ink-2);">Back to Profit Lab</a></p></div>`);
}

function renderReport(report) {
  const a = report.payload;
  const n = report.narrative;
  const name = report.account_name || 'Your business';
  const date = new Date(report.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  if (a.empty) {
    return shell(`Profit Truth Report — ${name}`, `
      <div class="page">
        <header><div class="kicker"><a href="/">&larr; Profit Lab</a></div>
        <h1>${esc(name)}</h1><div class="meta">Generated ${date}</div></header>
        <div class="headline">${esc(n.findings?.[0]?.body || 'We connected successfully, but this account does not have enough completed visits with recorded times yet to compute profit per hour. As your team completes scheduled work in Jobber, the numbers will build themselves — reconnect in a few weeks and the truth will be waiting.')}</div>
      </div>`);
  }

  const maxPerHour = Math.max(...a.categories.map(c => c.netOfMaterialsPerHour));
  const catRows = a.categories.map(c => {
    const pct = Math.max(6, Math.round((c.netOfMaterialsPerHour / maxPerHour) * 100));
    const cls = c.netOfMaterialsPerHour < a.totals.grossPerHour * 0.7 ? 'low' : (c.netOfMaterialsPerHour < a.totals.grossPerHour * 0.95 ? 'mid' : '');
    return `<tr><td>${esc(c.category)}</td><td class="num"><strong>${money(c.netOfMaterialsPerHour)}</strong></td>
      <td><div class="bar-holder"><div class="bar ${cls}" style="width:${pct}%"></div></div></td>
      <td class="num">${Math.round(c.laborHours)}</td><td class="num">${money(c.revenue)}</td></tr>`;
  }).join('');

  const findings = (n.findings || []).map((f, i) => `
    <div class="finding ${esc(f.tone)}">
      <h3>${i + 1}. ${esc(f.title)}</h3>
      <p>${esc(f.body)}</p>
      <p class="action">Do this: ${esc(f.action)}</p>
      ${f.worth ? `<span class="worth">Worth: ${esc(f.worth)}</span>` : ''}
    </div>`).join('');

  return shell(`Profit Truth Report — ${name}`, `
  <div class="page">
    <header>
      <div class="kicker"><a href="/">&larr; Profit Lab</a> &middot; Profit Truth Report</div>
      <h1>${esc(name)}</h1>
      <div class="meta">${a.jobCount} jobs &middot; ${a.visitCount} completed visits analyzed &middot; generated ${date}</div>
    </header>
    <div class="headline">${esc(n.headline)}</div>
    <div class="statrow">
      <div class="stat"><div class="n">${money(a.totals.revenue)}</div><div class="l">Earned revenue</div></div>
      <div class="stat"><div class="n">${Math.round(a.totals.laborHours)}</div><div class="l">Crew hours worked</div></div>
      <div class="stat"><div class="n">${money(a.totals.grossPerHour)}/hr</div><div class="l">Blended earnings rate</div></div>
      <div class="stat"><div class="n">${money(a.totals.unbilled)}</div><div class="l">Completed &amp; unbilled</div></div>
    </div>
    <h2>What each hour actually earns, by service</h2>
    <p style="color:var(--ink-2);">Revenue net of materials, divided by real crew hours from your visit records:</p>
    <table>
      <tr><th>Service line</th><th class="num">Per hour</th><th style="width:36%">&nbsp;</th><th class="num">Hours</th><th class="num">Revenue</th></tr>
      ${catRows}
    </table>
    <h2>The findings</h2>
    ${findings}
    <h2>Bottom line</h2>
    <p>${esc(n.bottomLine)}</p>
    ${report.subscription_status === 'active' ? `
    <div style="border:2px solid var(--green);border-radius:8px;padding:20px 24px;margin-top:28px;background:var(--green-soft);">
      <strong style="color:var(--navy);">You're a Profit Lab ${report.account_plan === 'founding' ? 'founding ' : ''}member.</strong>
      <span style="color:var(--ink-2);"> Your rate is locked forever. Weekly digests and monthly deep reports are rolling out to founding members first — you will get an email the day yours turns on.</span>
    </div>` : `
    <div style="border:2px solid var(--green);border-radius:8px;padding:24px 28px;margin-top:28px;">
      <h2 style="margin:0 0 8px;">Keep the truth coming</h2>
      <p style="color:var(--ink-2);margin-bottom:16px;">This report is a snapshot. Pricing leaks regrow every season — new clients, new services, unbilled work piling up. Profit Lab watches continuously: a weekly digest, a monthly deep report, and alerts when something starts leaking.</p>
      <a href="/subscribe?report=${report.id}&plan=founding" style="display:inline-block;background:var(--green);color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:6px;">Founding member — $39/mo, locked forever</a>
      <a href="/subscribe?report=${report.id}&plan=standard" style="display:inline-block;margin-left:10px;color:var(--navy);text-decoration:none;font-weight:600;padding:13px 10px;">or standard at $59/mo &rarr;</a>
      <div style="font-size:13px;color:var(--ink-2);margin-top:10px;">Cancel anytime in two clicks. If it doesn't pay for itself, don't keep it.</div>
    </div>`}
    <div class="method"><strong>How this was computed:</strong> revenue = invoiced + completed-but-uninvoiced work per job; crew hours = actual visit start/end times from your schedule; materials = expenses linked to jobs. Data read via the Jobber API — nothing in your account was modified. Advice written by Profit Lab's analysis engine from your numbers only. <a href="/disconnect?report=${report.id}" style="color:var(--ink-2);">Disconnect Profit Lab</a>.</div>
  </div>`);
}

module.exports = { renderReport, renderPending, renderError };
