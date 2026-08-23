/**
 * Michaelangelo — Integration Test Suite
 *
 * Tests the core server endpoints:
 * 1. Health check (settings/status)
 * 2. Model fetching
 * 3. Non-streaming agent (write file + read result)
 * 4. Streaming agent (SSE events)
 * 5. Chat completions proxy
 *
 * Run: node test/integration.js <port>
 */

const PORT = process.argv[2];
if (!PORT) { console.error('Usage: node test/integration.js <port>'); process.exit(1); }
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: null, raw: text }; }
}

// ============================================================================
// TEST SUITE
// ============================================================================

async function runTests() {
  console.log(`\n🧪 Integration Tests — ${BASE}\n`);

  // Test 1: Health check
  await test('GET /api/settings/status returns provider keys', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/settings/status`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof data === 'object', 'Response is not an object');
    assert('nvidia_nim' in data, 'Missing nvidia_nim key');
    assert('openrouter' in data, 'Missing openrouter key');
  });

  // Test 2: Models endpoint
  await test('GET /api/models returns model list', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/models`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.models), 'models is not an array');
  });

  // Test 3: Project detection
  await test('GET /api/project returns project info', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/project`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.type || data.framework, 'Missing type/framework');
  });

  // Test 4: Conversations list
  await test('GET /api/conversations returns list', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/conversations`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.conversations), 'conversations is not an array');
  });

  // Test 5: Stats endpoint
  await test('GET /api/stats returns token/cost stats', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/stats`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert('tokens' in data, 'Missing tokens');
  });

  // Test 6: Non-streaming agent (create a file)
  await test('POST /api/agent creates file and returns response', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'Create a file called test-integration.txt with content: integration test passed' }],
      }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert(data.choices, 'Missing choices');
    assert(data.agent_metadata, 'Missing agent_metadata');
    assert(data.agent_metadata.iterations > 0, 'No iterations');
    assert(data.agent_metadata.total_tool_calls > 0, 'No tool calls');
  });

  // Test 7: Streaming agent (SSE)
  await test('POST /api/agent/stream returns SSE events', async () => {
    const res = await fetch(`${BASE}/api/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'Say exactly: stream test ok' }],
      }),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);

    const text = await res.text();
    const events = [];
    // SSE format: event: X\ndata: {...}\n\n — split by double newline to get blocks
    const blocks = text.split('\n\n');
    for (const block of blocks) {
      const eventLine = block.split('\n').find(l => l.startsWith('event: '));
      if (eventLine) events.push(eventLine.slice(7).trim());
    }

    assert(events.includes('agent_start'), 'Missing agent_start event');
    assert(events.includes('iteration_start'), 'Missing iteration_start event');
    assert(events.includes('llm_call'), 'Missing llm_call event');
    assert(events.includes('agent_end'), 'Missing agent_end event');
    assert(events.includes('done'), 'Missing done event');
  });

  // Test 8: Chat completions proxy
  await test('POST /api/chat/completions returns chat response', async () => {
    const { status, data } = await fetchJSON(`${BASE}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 50,
      }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.choices, 'Missing choices');
    assert(data.choices[0].message.content, 'Missing content');
  });

  // Test 9: Error handling — missing model
  await test('POST /api/agent with missing model returns 400', async () => {
    const { status } = await fetchJSON(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // Test 10: WebSocket connection
  await test('WebSocket connects and receives init event', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('WebSocket timeout')); }, 5000);
      ws.on('open', () => {});
      ws.on('message', (msg) => {
        clearTimeout(timeout);
        const data = JSON.parse(msg.toString());
        assert(data.type === 'init', `Expected init event, got ${data.type}`);
        assert(Array.isArray(data.events), 'Missing events array');
        ws.close();
        resolve(true);
      });
      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
    assert(result === true, 'WebSocket did not connect');
  });

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}\n`);

  return failed === 0;
}

runTests().then(ok => process.exit(ok ? 0 : 1)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
