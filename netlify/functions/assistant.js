const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

  // Fallback to hardcoded IDs if env vars are not set in Netlify
  const FOUNDER_ASSISTANT_ID = process.env.FOUNDER_ASSISTANT_ID || 'asst_tA3jJ7ARTK4YwNNAM1m3efUJ';
  const ARTIST_ASSISTANT_ID = process.env.ARTIST_ASSISTANT_ID || 'asst_QIdgHVMGh0YsMJj9sb6p5Lsp';

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
    if (!res.ok) {
      const errMsg = json?.error?.message || `OpenAI error ${res.status}`;
      throw new Error(errMsg);
    }
    return json;
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

    if (!OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'OPENAI_API_KEY is not set in Netlify environment variables.' })
      };
    }

    try {
      const { action, threadId, clientType, message, runId } = JSON.parse(event.body);
      const assistantId = clientType === 'founder' ? FOUNDER_ASSISTANT_ID : ARTIST_ASSISTANT_ID;

      // GET CONFIG (exposes server env vars to client)
      if (action === 'get_config') {
        return { statusCode: 200, headers, body: JSON.stringify({ calendlyUrl: process.env.CALENDLY || '' }) };
      }

      // CREATE THREAD
      if (action === 'create_thread') {
        const thread = await openaiCall('/threads', 'POST', {});
        return { statusCode: 200, headers, body: JSON.stringify({ id: thread.id }) };
      }

      // ADD MESSAGE ONLY
      if (action === 'add_message') {
        const msg = await openaiCall(`/threads/${threadId}/messages`, 'POST', {
          role: 'user',
          content: message
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: msg.id }) };
      }

      // START RUN ONLY
      if (action === 'create_run') {
        const run = await openaiCall(`/threads/${threadId}/runs`, 'POST', {
          assistant_id: assistantId
        });
        return { statusCode: 200, headers, body: JSON.stringify({ runId: run.id, status: run.status }) };
      }

      // POLL RUN STATUS ONLY — lightweight, fast
      if (action === 'get_run') {
        const run = await openaiCall(`/threads/${threadId}/runs/${runId}`);
        return { statusCode: 200, headers, body: JSON.stringify({ status: run.status, runId: run.id }) };
      }

      // GET LATEST MESSAGE
      if (action === 'get_messages') {
        const messages = await openaiCall(`/threads/${threadId}/messages?limit=1&order=desc`);
        const reply = messages.data?.[0]?.content?.[0]?.text?.value || '';
        return { statusCode: 200, headers, body: JSON.stringify({ reply }) };
      }

      // NOTIFY MAKE — iPhone ping
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
  