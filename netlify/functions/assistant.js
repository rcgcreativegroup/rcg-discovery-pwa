const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const FOUNDER_ASSISTANT_ID = process.env.FOUNDER_ASSISTANT_ID;
const ARTIST_ASSISTANT_ID = process.env.ARTIST_ASSISTANT_ID;
const OPENAI_BASE = 'https://api.openai.com/v1';

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
    const { action, threadId, clientType, message, runId } = JSON.parse(event.body);

    const assistantId = clientType === 'founder' ? FOUNDER_ASSISTANT_ID : ARTIST_ASSISTANT_ID;

    let url, method, body;

    switch (action) {

      case 'create_thread':
        url = `${OPENAI_BASE}/threads`;
        method = 'POST';
        body = JSON.stringify({});
        break;

      case 'add_message':
        url = `${OPENAI_BASE}/threads/${threadId}/messages`;
        method = 'POST';
        body = JSON.stringify({ role: 'user', content: message });
        break;

      case 'create_run':
        url = `${OPENAI_BASE}/threads/${threadId}/runs`;
        method = 'POST';
        body = JSON.stringify({ assistant_id: assistantId });
        break;

      case 'get_run':
        url = `${OPENAI_BASE}/threads/${threadId}/runs/${runId}`;
        method = 'GET';
        body = null;
        break;

      case 'get_messages':
        url = `${OPENAI_BASE}/threads/${threadId}/messages?limit=1&order=desc`;
        method = 'GET';
        body = null;
        break;

      case 'notify':
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

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      ...(body ? { body } : {})
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
