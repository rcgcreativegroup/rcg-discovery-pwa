const {
    generateFounderReportWithRetry,
  } = require('./report-runner');

  const {
    evaluateFounderReportSemantics,
  } = require('./evaluate-report-semantics');

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
  const FOUNDER_ASSISTANT_ID = process.env.FOUNDER_ASSISTANT_ID || 'asst_tA3jJ7ARTK4YwNNAM1m3efUJ';
  const ARTIST_ASSISTANT_ID  = process.env.ARTIST_ASSISTANT_ID  || 'asst_QIdgHVMGh0YsMJj9sb6p5Lsp';
  const OPENAI_BASE = 'https://api.openai.com/v1';

  // ── Semantic evaluator prompt ─────────────────────────────────────────────────
  const SEMANTIC_EVALUATOR_SYSTEM_PROMPT = `You are a strict report evaluator for Robinson Creative Group.

  Your job is to evaluate whether a generated Founder Discovery Report faithfully follows the session data and the required reporting logic.

  You are NOT generating a report.
  You are ONLY grading the report.

  Return JSON only.

  Evaluation criteria:

  1. Template Fidelity
  - The report must behave like the required founder-facing structure.
  - It must not read like a summary disguised as a template.

  2. Session Grounding
  - Claims must be supported by the founder's actual transcript language.
  - Do not allow invented motivations, invented turning points, or unsupported conclusions.

  3. Verbatim Integrity
  - Any phrase presented as a direct quote must appear in the transcript either exactly or as a clearly faithful verbatim fragment.
  - Fail if key quoted phrases are invented or materially altered.

  4. Archetype Grounding
  - The archetype section must be tied to at least two actual founder phrases or clear transcript signals.
  - Fail if it reads as generic personality language.

  5. Gap Quality
  - "What We Need to Tighten" must identify actual thin or unresolved areas from the transcript.
  - It must remain observational, not prescriptive.
  - Fail if it invents coaching advice or gaps not supported by transcript evidence.

  6. Internal / Client Consistency
  - The client-facing section and internal section must appear to describe the same founder, same session, and same core signals.

  Scoring:
  - 9 to 10 = highly faithful and grounded
  - 7 to 8.9 = usable with minor issues
  - 6 to 6.9 = weak or partially grounded
  - below 6 = invalid for delivery

  Pass rule:
  - passed = true only if score >= 7.5 and there are no major failures in verbatim integrity, session grounding, or internal consistency.

  Return this exact JSON shape:
  {
    "passed": boolean,
    "score": number,
    "failures": [string],
    "warnings": [string],
    "reasons": {
      "templateFidelity": "pass|warn|fail",
      "sessionGrounding": "pass|warn|fail",
      "verbatimIntegrity": "pass|warn|fail",
      "archetypeGrounding": "pass|warn|fail",
      "gapQuality": "pass|warn|fail",
      "internalConsistency": "pass|warn|fail"
    }
  }`;

  function buildSemanticEvaluatorUserPrompt({ transcriptSource, clientOutput, internalOutput }) {
    return `Evaluate this generated founder report.

  SESSION TRANSCRIPT + DISCOVERY DATA:
  ${transcriptSource}

  GENERATED CLIENT OUTPUT:
  ${clientOutput}

  GENERATED INTERNAL OUTPUT:
  ${internalOutput}`;
  }

  // ──────────────────────────────────────────────────────────────────────────────

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

  // Latest assistant message — role-based: newest assistant turn only
  async function _getFinalAssistantMessage({ threadId }) {
    const messages = await openaiCall(`/threads/${threadId}/messages?limit=10&order=desc`);
    const msg = messages.data?.find(m => m.role === 'assistant');
    return msg?.content?.[0]?.text?.value || '';
  }

  async function _addUserMessageToThread({ threadId, content }) {
    await openaiCall(`/threads/${threadId}/messages`, 'POST', { role: 'user', content });
  }

  // Semantic evaluator — uses Chat Completions (JSON mode) for broad compatibility
  async function _runSemanticEvaluation({ transcriptSource, clientOutput, internalOutput }) {
    const userPrompt = buildSemanticEvaluatorUserPrompt({ transcriptSource, clientOutput, internalOutput });

    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SEMANTIC_EVALUATOR_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return JSON.parse(text);
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

      // GENERATE REPORT — server-side: run creation, structural validation, semantic eval, retry
      if (action === 'generate_report') {
        const result = await generateFounderReportWithRetry({
          threadId,
          assistantId,
          createRun:                _createRun,
          waitForRunCompletion:     _waitForRunCompletion,
          getFinalAssistantMessage: _getFinalAssistantMessage,
          addUserMessageToThread:   _addUserMessageToThread,
          evaluateReportSemantics: async ({ transcriptSource, clientOutput, internalOutput }) =>
            evaluateFounderReportSemantics({
              runSemanticEvaluation: _runSemanticEvaluation,
              transcriptSource,
              clientOutput,
              internalOutput,
            }),
          semanticBlockingEnabled: false,  // logs scores; does NOT block delivery yet
          maxAttempts: 3,
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
  