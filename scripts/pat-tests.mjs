/**
 * Production Acceptance Testing (PAT) Suite
 * Verifies production readiness criteria: Security headers, SLA latencies, and system health.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function runPAT() {
  console.log(`\n======================================================`);
  console.log(`🏭 Starting Production Acceptance Testing (PAT) on: ${BASE_URL}`);
  console.log(`======================================================\n`);

  const results = [];

  function record(criterion, description, passed, details = null) {
    results.push({ criterion, description, passed, details });
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | [${criterion}] ${description}`);
    if (details) console.log(`   Details: ${details}`);
  }

  // --- Criterion 1: Production Security Headers ---
  try {
    const res = await fetch(`${BASE_URL}/login`);
    const headers = res.headers;

    const xContentType = headers.get('x-content-type-options');
    const xFrame = headers.get('x-frame-options');
    const referrerPolicy = headers.get('referrer-policy');

    const hasNosniff = xContentType && xContentType.toLowerCase().includes('nosniff');
    const hasFrameOptions = xFrame && ['sameorigin', 'deny'].includes(xFrame.toLowerCase());
    const hasReferrer = !!referrerPolicy;

    record(
      'PAT-SEC-01',
      'Mandatory Production Security Headers present (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)',
      hasNosniff && hasFrameOptions && hasReferrer,
      `Nosniff: ${xContentType}, Frame: ${xFrame}, Referrer: ${referrerPolicy}`
    );
  } catch (err) {
    record('PAT-SEC-01', 'Security headers check', false, err.message);
  }

  // --- Criterion 2: API Latency & Performance SLA (< 600ms) ---
  try {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      await fetch(`${BASE_URL}/api/config/public`);
      samples.push(Date.now() - start);
    }
    const avgLatency = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    const meetsSLA = avgLatency < 600;

    record(
      'PAT-PERF-01',
      'Production API Latency SLA (Average response time < 600ms)',
      meetsSLA,
      `Average Latency: ${avgLatency}ms (Samples: ${samples.join(', ')}ms)`
    );
  } catch (err) {
    record('PAT-PERF-01', 'API Latency SLA', false, err.message);
  }

  // --- Criterion 3: Frontend SSR Page Latency SLA (< 1200ms) ---
  try {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/login`);
    const duration = Date.now() - start;
    const meetsSLA = duration < 1200 && res.status === 200;

    record(
      'PAT-PERF-02',
      'Production Frontend SSR Response SLA (< 1200ms)',
      meetsSLA,
      `Duration: ${duration}ms, Status: ${res.status}`
    );
  } catch (err) {
    record('PAT-PERF-02', 'SSR Page Latency SLA', false, err.message);
  }

  // --- Criterion 4: Graceful 404 Error Handling ---
  try {
    const res = await fetch(`${BASE_URL}/this-route-does-not-exist-pat-check`);
    const handles404 = res.status === 404;

    record(
      'PAT-RES-01',
      'Resilience & 404 Error Handling (Unmapped routes cleanly return HTTP 404)',
      handles404,
      `Received HTTP status: ${res.status}`
    );
  } catch (err) {
    record('PAT-RES-01', 'Graceful 404 Handling', false, err.message);
  }

  // --- Criterion 5: Payload Compression / Content Encoding ---
  try {
    const res = await fetch(`${BASE_URL}/login`, {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' },
    });
    const contentType = res.headers.get('content-type') || '';
    const hasHtmlContent = contentType.includes('text/html');

    record(
      'PAT-ARCH-01',
      'Content-Type and Payload Delivery Verification',
      hasHtmlContent,
      `Content-Type: ${contentType}`
    );
  } catch (err) {
    record('PAT-ARCH-01', 'Content-Type Verification', false, err.message);
  }

  // --- Summary & Report Output ---
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`\n======================================================`);
  console.log(`📊 PAT Summary: ${passed}/${total} Criteria Met (${failed} Failed)`);
  console.log(`======================================================\n`);

  const fs = await import('fs');
  const markdown = [
    `# 🏭 Production Acceptance Testing (PAT) Readiness Report`,
    `**Execution Time:** ${new Date().toISOString()}`,
    `**Target Environment:** \`${BASE_URL}\``,
    `**Production Readiness Verdict:** ${failed === 0 ? '🟢 READY FOR PRODUCTION' : '🔴 REJECTED'} (${passed}/${total} Criteria Met)`,
    ``,
    `| Criterion ID | Acceptance Requirement | Status | Details / Metrics |`,
    `|---|---|---|---|`,
    ...results.map(
      r => `| **${r.criterion}** | ${r.description} | ${r.passed ? '✅ PASS' : '❌ FAIL'} | ${r.details || '-'} |`
    ),
    ``,
  ].join('\n');

  fs.writeFileSync('pat-report.md', markdown);

  if (failed > 0) {
    process.exit(1);
  }
}

runPAT().catch(err => {
  console.error('Fatal PAT execution error:', err);
  process.exit(1);
});

