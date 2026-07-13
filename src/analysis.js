// The profit engine — pulls a connected account's jobs, visits, and expenses
// and computes profit-per-hour truth. Ported from the Step 1 engine.
const { graphql } = require('./jobber');

const HOURLY_LABOR_COST = 22;

function hours(startAt, endAt) {
  return (new Date(endAt) - new Date(startAt)) / 3600000;
}

// Generic service-line classifier — works beyond lawn care.
function classify(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('commercial')) return 'Commercial maintenance';
  if (t.includes('mow')) return 'Residential mowing';
  if (t.includes('cleanup') || t.includes('clean up') || t.includes('clean-up')) return 'Cleanups';
  if (t.includes('fertiliz') || t.includes('treatment') || t.includes('spray')) return 'Treatments';
  if (t.includes('mulch') || t.includes('landscap') || t.includes('install')) return 'Installs & landscaping';
  if (t.includes('snow')) return 'Snow';
  if (t.includes('repair') || t.includes('service call')) return 'Repairs & service calls';
  return title ? title.slice(0, 40) : 'Other';
}

async function pullAllJobs(account) {
  const jobs = [];
  let cursor = null;
  while (true) {
    const d = await graphql(account, `
      query Jobs($after: String) {
        jobs(first: 10, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id jobNumber title total invoicedTotal uninvoicedTotal
            client { id name }
            visits(first: 50) { nodes { title startAt endAt isComplete } }
            expenses(first: 20) { nodes { title total } }
          }
        }
      }`, { after: cursor });
    jobs.push(...d.jobs.nodes);
    if (!d.jobs.pageInfo.hasNextPage) break;
    cursor = d.jobs.pageInfo.endCursor;
  }
  return jobs;
}

async function pullUnlinkedExpenses(account) {
  const expenses = [];
  let cursor = null;
  while (true) {
    const d = await graphql(account, `
      query Expenses($after: String) {
        expenses(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { title total date linkedJob { id } }
        }
      }`, { after: cursor });
    expenses.push(...d.expenses.nodes);
    if (!d.expenses.pageInfo.hasNextPage) break;
    cursor = d.expenses.pageInfo.endCursor;
  }
  return expenses;
}

async function runAnalysis(account) {
  const jobs = await pullAllJobs(account);
  const allExpenses = await pullUnlinkedExpenses(account).catch(() => []); // expenses scope may be absent

  const jobRows = jobs.map(j => {
    const completed = j.visits.nodes.filter(v => v.isComplete && v.startAt && v.endAt);
    const laborHours = completed.reduce((s, v) => s + hours(v.startAt, v.endAt), 0);
    const materials = j.expenses ? j.expenses.nodes.reduce((s, e) => s + (e.total || 0), 0) : 0;
    const revenue = j.invoicedTotal + j.uninvoicedTotal;
    return {
      jobNumber: j.jobNumber, title: j.title, category: classify(j.title),
      client: j.client.name,
      revenue, invoiced: j.invoicedTotal, uninvoiced: j.uninvoicedTotal,
      laborHours, materials, visitCount: completed.length,
      grossPerHour: laborHours > 0 ? revenue / laborHours : null,
    };
  }).filter(r => r.laborHours > 0);

  if (jobRows.length === 0) {
    return { empty: true, jobCount: jobs.length };
  }

  const categories = {};
  for (const r of jobRows) {
    const c = categories[r.category] ||= { category: r.category, revenue: 0, laborHours: 0, materials: 0, jobs: 0, visits: 0, uninvoiced: 0 };
    c.revenue += r.revenue; c.laborHours += r.laborHours; c.materials += r.materials;
    c.jobs += 1; c.visits += r.visitCount; c.uninvoiced += r.uninvoiced;
  }
  const categoryRows = Object.values(categories).map(c => ({
    ...c,
    grossPerHour: c.revenue / c.laborHours,
    netOfMaterialsPerHour: (c.revenue - c.materials) / c.laborHours,
  })).sort((a, b) => b.netOfMaterialsPerHour - a.netOfMaterialsPerHour);

  // Client outliers within the largest recurring category
  const biggest = categoryRows.reduce((a, b) => (b.laborHours > a.laborHours ? b : a), categoryRows[0]);
  const inBiggest = jobRows.filter(r => r.category === biggest.category && r.grossPerHour !== null);
  const avg = inBiggest.reduce((s, r) => s + r.grossPerHour, 0) / (inBiggest.length || 1);
  const outliers = inBiggest
    .map(r => ({ client: r.client, perHour: r.grossPerHour, gapPct: ((r.grossPerHour - avg) / avg) * 100, laborHours: r.laborHours, revenue: r.revenue }))
    .sort((a, b) => a.perHour - b.perHour)
    .slice(0, 5);

  const totalHours = jobRows.reduce((s, r) => s + r.laborHours, 0);
  const totalRevenue = jobRows.reduce((s, r) => s + r.revenue, 0);
  const totalMaterials = jobRows.reduce((s, r) => s + r.materials, 0);
  const unbilled = jobRows.reduce((s, r) => s + r.uninvoiced, 0);
  const overhead = allExpenses.filter(e => !e.linkedJob).reduce((s, e) => s + (e.total || 0), 0);

  return {
    empty: false,
    assumptions: { hourlyLaborCost: HOURLY_LABOR_COST, hoursSource: 'visit start/end times' },
    totals: {
      revenue: totalRevenue, laborHours: totalHours, materials: totalMaterials, overhead,
      grossPerHour: totalRevenue / totalHours, unbilled,
    },
    categories: categoryRows,
    outlierCategory: biggest.category,
    outlierAvgPerHour: avg,
    clientOutliers: outliers,
    jobCount: jobRows.length,
    visitCount: jobRows.reduce((s, r) => s + r.visitCount, 0),
  };
}

module.exports = { runAnalysis, classify };
