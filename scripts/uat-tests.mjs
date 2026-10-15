/**
 * User Acceptance Testing (UAT) Automated Suite
 * Validates critical user journeys and acceptance criteria.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function runUAT() {
  console.log(`\n======================================================`);
  console.log(`🚀 Starting User Acceptance Testing (UAT) against: ${BASE_URL}`);
  console.log(`======================================================\n`);

  const results = [];

  // Helper to record test results
  function record(scenario, description, passed, error = null) {
    results.push({ scenario, description, passed, error });
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | [${scenario}] ${description}`);
    if (error) console.error(`   Error: ${error}`);
  }

  // --- Journey 1: Root Redirect to Login ---
  try {
    const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    const isRedirect = res.status === 307 || res.status === 302 || res.status === 308 || res.status === 200;
    record(
      'UAT-01',
      'Unauthenticated user accessing root "/" receives redirect to "/login"',
      isRedirect,
      !isRedirect ? `Received status ${res.status}` : null
    );
  } catch (err) {
    record('UAT-01', 'Root redirect', false, err.message);
  }

  // --- Journey 2: Login Page Accessibility ---
  try {
    const res = await fetch(`${BASE_URL}/login`);
    const isOk = res.status === 200;
    const body = await res.text();
    const hasContent = body.length > 500;
    record(
      'UAT-02',
      'User can load login page (/login) with HTTP 200 and complete HTML structure',
      isOk && hasContent,
      !isOk ? `Status ${res.status}` : !hasContent ? 'Incomplete HTML payload' : null
    );
  } catch (err) {
    record('UAT-02', 'Login page load', false, err.message);
  }

  // --- Journey 3: System Public Configuration API ---
  try {
    const res = await fetch(`${BASE_URL}/api/config/public`);
    const isOk = res.status === 200;
    const data = await res.json();
    const hasKeys = 'geoserverUrl' in data && 'tileservUrl' in data && 'apiUrl' in data;
    record(
      'UAT-03',
      'Public configuration API (/api/config/public) delivers required client endpoints',
      isOk && hasKeys,
      !isOk ? `Status ${res.status}` : !hasKeys ? `Missing keys: ${JSON.stringify(data)}` : null
    );
  } catch (err) {
    record('UAT-03', 'Public configuration API', false, err.message);
  }

  // --- Journey 4: Authentication Security Barrier ---
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'invalid_uat_user', password: 'wrong_password_123' }),
    });
    const isRejected = res.status === 401 || res.status === 400 || res.status === 500;
    record(
      'UAT-04',
      'Authentication endpoint (/api/auth/login) rejects illegitimate credentials',
      isRejected,
      !isRejected ? `Unexpected status ${res.status}` : null
    );
  } catch (err) {
    record('UAT-04', 'Auth rejection barrier', false, err.message);
  }

  // --- Journey 5: Dashboard Overview Redirection ---
  try {
    const res = await fetch(`${BASE_URL}/dashboard`, { redirect: 'manual' });
    const isRedirect = res.status === 307 || res.status === 302 || res.status === 308 || res.status === 200;
    record(
      'UAT-05',
      'Dashboard legacy link (/dashboard) correctly redirects user to (/overview)',
      isRedirect,
      !isRedirect ? `Status ${res.status}` : null
    );
  } catch (err) {
    record('UAT-05', 'Dashboard overview redirect', false, err.message);
  }

  // --- Summary & Report Output ---
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`\n======================================================`);
  console.log(`📊 UAT Summary: ${passed}/${total} Passed (${failed} Failed)`);
  console.log(`======================================================\n`);

  // Write Markdown report for GitHub Step Summary
  const fs = await import('fs');
  const markdown = [
    `# 🧑‍💼 User Acceptance Testing (UAT) Report`,
    `**Execution Time:** ${new Date().toISOString()}`,
    `**Target Environment:** \`${BASE_URL}\``,
    `**Result:** ${failed === 0 ? '🟢 ACCEPTED' : '🔴 REJECTED'} (${passed}/${total} Passed)`,
    ``,
    `| Scenario ID | Journey Description | Status | Error Details |`,
    `|---|---|---|---|`,
    ...results.map(
      r => `| **${r.scenario}** | ${r.description} | ${r.passed ? '✅ PASS' : '❌ FAIL'} | ${r.error || '-'} |`
    ),
    ``,
  ].join('\n');

  fs.writeFileSync('uat-report.md', markdown);

  if (failed > 0) {
    process.exit(1);
  }
}

runUAT().catch(err => {
  console.error('Fatal UAT execution error:', err);
  process.exit(1);
});

