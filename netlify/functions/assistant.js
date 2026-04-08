const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const FOUNDER_ASSISTANT_ID = process.env.FOUNDER_ASSISTANT_ID;
const ARTIST_ASSISTANT_ID = process.env.ARTIST_ASSISTANT_ID;
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
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { action, threadId, clientType, message } = JSON.parse(event.body);
    const assistantId = clientType === 'founder' ? FOUNDER_ASSISTANT_ID : ARTIST_ASSISTANT_ID;

    // ── CREATE THREAD ──
    if (action === 'create_thread') {
      const thread = await openaiCall('/threads', 'POST', {});
      return { statusCode: 200, headers, body: JSON.stringify(thread) };
    }

    // ── SEND MESSAGE + RUN + WAIT + RETURN RESPONSE ──
    // One call handles everything — no timeout issues
    if (action === 'send_and_wait') {
      // Add user message
      await openaiCall(`/threads/${threadId}/messages`, 'POST', {
        role: 'user',
        content: message
      });

      // Start run
      const run = await openaiCall(`/threads/${threadId}/runs`, 'POST', {
        assistant_id: assistantId
      });

      // Poll until complete (max 20 seconds)
      let status = run.status;
      let attempts = 0;
      let currentRun = run;

      while (attempts < 18 && status !== 'completed' && status !== 'failed' && status !== 'cancelled' && status !== 'expired') {
        await sleep(1500);
        attempts++;
        currentRun = await openaiCall(`/threads/${threadId}/runs/${run.id}`);
        status = currentRun.status;
      }

      if (status !== 'completed') {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: 'timeout', status, attempts })
        };
      }

      // Get the assistant response
      const messages = await openaiCall(`/threads/${threadId}/messages?limit=1&order=desc`);
      const reply = messages.data?.[0]?.content?.[0]?.text?.value || '';

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply, status: 'completed' })
      };
    }

    // ── NOTIFY MAKE ──
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

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
