const {
    splitInternalBlock,
    validateFounderClientOutput,
  } = require("./report-validator");

  function getDefaultSemanticCheck(message = "Semantic evaluation not run.") {
    return {
      passed: false,
      score: 0,
      failures: [message],
      warnings: [],
      reasons: {
        templateFidelity: "fail",
        sessionGrounding: "fail",
        verbatimIntegrity: "fail",
        archetypeGrounding: "fail",
        gapQuality: "fail",
        internalConsistency: "fail",
      },
    };
  }

  function checkSectionDepth(clientOutput) {
    const anchors = [
      "S \u2014 Story Clarity",
      "O \u2014 Origin Depth",
      "U \u2014 Uniqueness Signal",
      "L \u2014 Legacy Intention",
      "YOUR FOUNDER ARCHETYPE SIGNAL\u2122",
      "WHAT WE NEED TO TIGHTEN",
    ];

    const found = anchors
      .map((anchor) => ({ anchor, idx: clientOutput.indexOf(anchor) }))
      .filter((a) => a.idx !== -1)
      .sort((a, b) => a.idx - b.idx);

    const thinSections = [];

    for (let i = 0; i < found.length; i++) {
      const { anchor, idx } = found[i];
      const nextIdx = found[i + 1] ? found[i + 1].idx : clientOutput.length;
      const afterAnchor = clientOutput.slice(idx + anchor.length, nextIdx);
      const bodyChars = afterAnchor.replace(/\s+/g, "").length;
      const hasNewline = afterAnchor.includes("\n");
      if (bodyChars < 80 || !hasNewline) {
        thinSections.push(anchor);
      }
    }

    return { passed: thinSections.length === 0, thinSections };
  }

  function checkTranscriptIntegrity(internalOutput) {
    if (!internalOutput || internalOutput.trim().length < 50) {
      return { passed: false, reason: "Internal block missing or empty" };
    }

    const hasMarker =
      internalOutput.includes("\u2501\u2501\u2501 INTERNAL DATA BLOCK \u2014 BEGIN \u2501\u2501\u2501") ||
      internalOutput.includes("INTERNAL DATA BLOCK");

    if (!hasMarker) {
      return { passed: false, reason: "Internal block marker not found" };
    }

    if (!internalOutput.includes("\u2501\u2501\u2501 FULL DISCOVERY TRANSCRIPT \u2501\u2501\u2501")) {
      return { passed: false, reason: "Full Discovery Transcript header missing" };
    }

    const forbidden = [
      "[FULL VERBATIM CONTINUES",
      "[TRANSCRIPT OMITTED",
      "[All remaining turns",
      "continues...]",
    ];
    const hit = forbidden.find((f) => internalOutput.includes(f));
    if (hit) {
      return { passed: false, reason: `Forbidden placeholder found: ${hit}` };
    }

    const qMatches = (internalOutput.match(/^Q:/gm) || []).length;
    const aMatches = (internalOutput.match(/^A:/gm) || []).length;
    if (qMatches < 2 || aMatches < 2) {
      return {
        passed: false,
        reason: `Insufficient transcript exchanges — found ${qMatches} Q: and ${aMatches} A: blocks (minimum 2 each required)`,
      };
    }

    return { passed: true, reason: null };
  }

  function isNearValid({ validation, spoofCheck, transcriptCheck }) {
    return (
      validation.missing.length <= 2 &&
      validation.forbiddenHits.length === 0 &&
      spoofCheck.thinSections.length <= 1 &&
      transcriptCheck.passed
    );
  }

  function buildMalformedRetryMessage() {
    return "The previous output was empty or malformed. Regenerate the full report using Knowledge Doc 03 exactly.";
  }

  function buildStructuralRetryMessage({ validation, spoofCheck, transcriptCheck }) {
    const missingList =
      validation.missing.length > 0
        ? validation.missing.map((a) => `- "${a}"`).join("\n")
        : "None";

    const forbiddenList =
      validation.forbiddenHits.length > 0
        ? validation.forbiddenHits.map((h) => `- ${h}`).join("\n")
        : "None";

    const spoofList =
      spoofCheck.thinSections.length > 0
        ? spoofCheck.thinSections.map((s) => `- ${s}`).join("\n")
        : "None";

    const transcriptWarning = transcriptCheck.passed
      ? ""
      : `\nTRANSCRIPT ISSUE: ${transcriptCheck.reason}. Include the full verbatim Q:/A: transcript in the INTERNAL DATA BLOCK with no placeholders.`;

    return `FORMAT CORRECTION — INVALID OUTPUT

  The previous output was rejected because it did not follow Knowledge Doc 03.

  You MUST regenerate the report using the exact required structure.

  Required anchors that MUST appear exactly as written:
  - "Your S.O.U.L Identity Score\u2122"
  - "S \u2014 Story Clarity"
  - "O \u2014 Origin Depth"
  - "U \u2014 Uniqueness Signal"
  - "L \u2014 Legacy Intention"
  - "YOUR FOUNDER ARCHETYPE SIGNAL\u2122"
  - "WHAT WE NEED TO TIGHTEN"

  Do not rename sections.
  Do not change wording.
  Do not create custom titles.

  Missing from your previous output:
  ${missingList}

  Forbidden patterns found in your previous output:
  ${forbiddenList}

  Sections present but with insufficient content:
  ${spoofList}
  ${transcriptWarning}

  Regenerate the full report now following Knowledge Doc 03 exactly.`;
  }

  function buildSemanticRetryMessage(semanticCheck) {
    const failureList =
      Array.isArray(semanticCheck.failures) && semanticCheck.failures.length > 0
        ? semanticCheck.failures.map((f) => `- ${f}`).join("\n")
        : "- Semantic evaluation failed without specific reasons.";

    const warningList =
      Array.isArray(semanticCheck.warnings) && semanticCheck.warnings.length > 0
        ? `\nWarnings:\n${semanticCheck.warnings.map((w) => `- ${w}`).join("\n")}`
        : "";

    return `SEMANTIC CORRECTION — INVALID REPORT

  The previous output passed structural checks but failed semantic evaluation.

  You MUST regenerate the report with tighter grounding in the founder's actual transcript.

  Semantic failures detected:
  ${failureList}${warningList}

  Requirements:
  - Do not invent quotes
  - Do not invent motivations
  - Ground the archetype narrative in at least two real founder phrases
  - Keep "What We Need to Tighten" observational and transcript-supported
  - Keep internal and client sections consistent with the same founder and same session

  Regenerate the full report now following Knowledge Doc 03 exactly.`;
  }

  async function generateFounderReportWithRetry({
    threadId,
    assistantId,
    createRun,
    waitForRunCompletion,
    getFinalAssistantMessage,
    addUserMessageToThread,
    evaluateReportSemantics,
    semanticBlockingEnabled = false,
    maxAttempts = 3,
  }) {
    let lastFailure = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { runId } = await createRun({ threadId, assistantId });
      await waitForRunCompletion({ threadId, runId });

      let rawFinalAssistantText;

      try {
        rawFinalAssistantText = await getFinalAssistantMessage({ threadId });
      } catch (err) {
        lastFailure = {
          attempt,
          rawFinalAssistantText: "",
          clientOutput: "",
          internalOutput: "",
          hasInternalBlock: false,
          validation: { valid: false, missing: ["fetch failed"], forbiddenHits: [] },
          spoofCheck: { passed: false, thinSections: [] },
          transcriptCheck: { passed: false, reason: `Message fetch failed: ${err.message}` },
          semanticCheck: getDefaultSemanticCheck(`Semantic evaluation not run because message fetch failed: ${err.message}`),
        };
        if (attempt < maxAttempts) {
          await addUserMessageToThread({ threadId, content: buildMalformedRetryMessage() });
          continue;
        }
        break;
      }

      if (!rawFinalAssistantText || rawFinalAssistantText.trim().length < 100) {
        lastFailure = {
          attempt,
          rawFinalAssistantText: rawFinalAssistantText || "",
          clientOutput: "",
          internalOutput: "",
          hasInternalBlock: false,
          validation: { valid: false, missing: ["empty response"], forbiddenHits: [] },
          spoofCheck: { passed: false, thinSections: [] },
          transcriptCheck: { passed: false, reason: "Response was empty or too short" },
          semanticCheck: getDefaultSemanticCheck("Semantic evaluation not run because response was empty or too short."),
        };
        if (attempt < maxAttempts) {
          await addUserMessageToThread({ threadId, content: buildMalformedRetryMessage() });
          continue;
        }
        break;
      }

      const { clientOutput, internalOutput, hasInternalBlock } = splitInternalBlock(rawFinalAssistantText);
      const validation = validateFounderClientOutput(clientOutput);
      const spoofCheck = checkSectionDepth(clientOutput);
      const transcriptCheck = checkTranscriptIntegrity(internalOutput);
      const structuralValid = validation.valid && spoofCheck.passed && transcriptCheck.passed;

      let semanticCheck = getDefaultSemanticCheck();

      if (structuralValid && typeof evaluateReportSemantics === "function") {
        semanticCheck = await evaluateReportSemantics({
          transcriptSource: rawFinalAssistantText,
          clientOutput,
          internalOutput,
        });
      }

      const semanticPassForDelivery = semanticBlockingEnabled ? semanticCheck.passed : true;
      const fullyValid = structuralValid && semanticPassForDelivery;

      if (fullyValid) {
        return {
          ok: true,
          attempt,
          rawFinalAssistantText,
          clientOutput,
          internalOutput,
          hasInternalBlock,
          validation,
          spoofCheck,
          transcriptCheck,
          semanticCheck,
        };
      }

      lastFailure = {
        attempt,
        rawFinalAssistantText,
        clientOutput,
        internalOutput,
        hasInternalBlock,
        validation,
        spoofCheck,
        transcriptCheck,
        semanticCheck,
      };

      const closeEnoughForExtraAttempt = isNearValid({ validation, spoofCheck, transcriptCheck });
      const shouldRetry = attempt < maxAttempts && (attempt === 1 || closeEnoughForExtraAttempt);

      if (!shouldRetry) continue;

      if (structuralValid && semanticBlockingEnabled && !semanticCheck.passed) {
        await addUserMessageToThread({ threadId, content: buildSemanticRetryMessage(semanticCheck) });
      } else if (!structuralValid) {
        await addUserMessageToThread({ threadId, content: buildStructuralRetryMessage({ validation, spoofCheck, transcriptCheck }) });
      }
    }

    return { ok: false, ...lastFailure };
  }

  module.exports = { generateFounderReportWithRetry };
  