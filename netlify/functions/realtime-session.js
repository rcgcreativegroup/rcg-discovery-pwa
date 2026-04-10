const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime';
const REALTIME_VOICE = process.env.REALTIME_VOICE || 'marin';
const REALTIME_TTL_SECONDS = Number(process.env.REALTIME_TTL_SECONDS || 60);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!OPENAI_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'OPENAI_API_KEY is not set.' }) };
  }

  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    const clientType = payload.clientType === 'artist' ? 'artist' : 'founder';

    const sessionConfig = {
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: clientType === 'artist'
          ? 'You are the Robinson Creative Group discovery guide for artists. Keep a calm, premium, voice-friendly tone.'
          : 'You are the Robinson Creative Group discovery guide for founders. Keep a calm, premium, voice-friendly tone.',
        audio: {
          output: {
            voice: REALTIME_VOICE
          }
        }
      },
      expires_after: {
        anchor: 'created_at',
        seconds: REALTIME_TTL_SECONDS
      }
    };

    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sessionConfig)
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: data?.error?.message || 'Failed to create realtime session.'
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        clientType,
        session: data,
        client_secret: data.client_secret || null,
        model: REALTIME_MODEL,
        voice: REALTIME_VOICE,
        expires_after_seconds: REALTIME_TTL_SECONDS
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to create realtime session.' })
    };
  }
};
