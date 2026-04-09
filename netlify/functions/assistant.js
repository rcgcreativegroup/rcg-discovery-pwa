const {
    generateFounderReportWithRetry,
  } = require('./report-runner');

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
  const FOUNDER_ASSISTANT_ID = process.env.FOUNDER_ASSISTANT_ID || 'asst_tA3jJ7ARTK4YwNNAM1m3efUJ';
  const ARTIST_ASSISTANT_ID  = process.env.ARTIST_ASSISTANT_ID  || 'asst_QIdgHVMGh0YsMJj9sb6p5Lsp';
  const OPENAI_BASE = 'https://api.openai.com/v1';

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function openaiCall(path, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${OPENAI_BASE}${path}`, options);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
    return json;
  }

  // ── Helpers wired into generateFounderReportWithRetry ─────────────────────────

  async function _createRun({ threadId, assistantId }) {
    const run = await openaiCall(`/threads/${threadId}/runs`, 'POST', { assistant_id: assistantId });
    return { runId: run.id };
  }

  // Server-side poll — max 22 s to stay within the 26 s Netlify timeout
  async function _waitForRunCompletion({ threadId, runId }) {
    const deadline = Date.now() + 22000;
    while (Date.now() < deadline) {
      const run = await openaiCall(`/threads/${threadId}/runs/${runId}`);
      if (run.status === 'completed') return run;
      if (['failed', 'cancelled', 'expired'].includes(run.status)) {
        throw new Error(`Run ended with status: ${run.status}`);
      }
      await sleep(2000);
    }
    throw new Error('Run timed out after 22 s');
  }

  // Latest assistant message — newest assistant turn only (role-based dedup)
  async function _getFinalAssistantMessage({ threadId }) {
    const messages = await openaiCall(`/threads/${threadId}/messages?limit=10&order=desc`);
    const msg = messages.data?.find(m => m.role === 'assistant');
    return msg?.content?.[0]?.text?.value || '';
  }

  async function _addUserMessageToThread({ threadId, content }) {
    await openaiCall(`/threads/${threadId}/messages`, 'POST', { role: 'user', content });
  }

  // ──────────────────────────────────────────────────────────────────────────────

  exports.handler = async (event) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    if (!OPENAI_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'OPENAI_API_KEY is not set.' }) };
    }

    try {
      const { action, threadId, clientType, message, runId } = JSON.parse(event.body);
      const assistantId = clientType === 'founder' ? FOUNDER_ASSISTANT_ID : ARTIST_ASSISTANT_ID;

      if (action === 'get_config') {
        return { statusCode: 200, headers, body: JSON.stringify({ calendlyUrl: process.env.CALENDLY || '' }) };
      }

      if (action === 'create_thread') {
        const thread = await openaiCall('/threads', 'POST', {});
        return { statusCode: 200, headers, body: JSON.stringify({ id: thread.id }) };
      }

      if (action === 'add_message') {
        const msg = await openaiCall(`/threads/${threadId}/messages`, 'POST', { role: 'user', content: message });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: msg.id }) };
      }

      if (action === 'create_run') {
        const run = await openaiCall(`/threads/${threadId}/runs`, 'POST', { assistant_id: assistantId });
        return { statusCode: 200, headers, body: JSON.stringify({ runId: run.id, status: run.status }) };
      }

      if (action === 'get_run') {
        const run = await openaiCall(`/threads/${threadId}/runs/${runId}`);
        return { statusCode: 200, headers, body: JSON.stringify({ status: run.status, runId: run.id }) };
      }

      if (action === 'get_messages') {
        const messages = await openaiCall(`/threads/${threadId}/messages?limit=10&order=desc`);
        const assistantMsg = messages.data?.find(m => m.role === 'assistant');
        const reply = assistantMsg?.content?.[0]?.text?.value || '';
        const COMPLETION_MARKER = '\u2501\u2501\u2501 INTERNAL DATA BLOCK \u2014 BEGIN \u2501\u2501\u2501';
        const sessionComplete = reply.includes(COMPLETION_MARKER);
        return { statusCode: 200, headers, body: JSON.stringify({ reply, sessionComplete }) };
      }

      // GENERATE REPORT — validates client output, retries once if anchors are missing
      if (action === 'generate_report') {
        const result = await generateFounderReportWithRetry({
          threadId,
          assistantId,
          createRun:                _createRun,
          waitForRunCompletion:     _waitForRunCompletion,
          getFinalAssistantMessage: _getFinalAssistantMessage,
          addUserMessageToThread:   _addUserMessageToThread,
          maxAttempts: 2
        });
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }

      if (action === 'notify') {
        if (MAKE_WEBHOOK_URL) {
          await fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_type: clientType,
              session_id: threadId,
              date: new Date().toISOString(),
              message: `New ${clientType} discovery session completed`
            })
          });
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'cancel_run') {
        try {
          const cancelled = await openaiCall(`/threads/${threadId}/runs/${runId}/cancel`, 'POST', {});
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: cancelled.status }) };
        } catch (e) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: false, note: e.message }) };
        }
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  };
  