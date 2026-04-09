function safeFail(message) {
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

  function normalizeEvaluatorResult(result) {
    if (!result || typeof result !== "object") {
      return safeFail("Semantic evaluator returned invalid data.");
    }

    const reasons = result.reasons || {};

    return {
      passed: result.passed === true,
      score: typeof result.score === "number" ? result.score : 0,
      failures: Array.isArray(result.failures)
        ? result.failures
        : ["Semantic evaluator returned malformed failures array."],
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      reasons: {
        templateFidelity: reasons.templateFidelity || "fail",
        sessionGrounding: reasons.sessionGrounding || "fail",
        verbatimIntegrity: reasons.verbatimIntegrity || "fail",
        archetypeGrounding: reasons.archetypeGrounding || "fail",
        gapQuality: reasons.gapQuality || "fail",
        internalConsistency: reasons.internalConsistency || "fail",
      },
    };
  }

  async function evaluateFounderReportSemantics({
    runSemanticEvaluation,
    transcriptSource,
    clientOutput,
    internalOutput,
  }) {
    try {
      if (!runSemanticEvaluation || typeof runSemanticEvaluation !== "function") {
        return safeFail("Semantic evaluator function not provided.");
      }
      if (!clientOutput || !internalOutput) {
        return safeFail("Semantic evaluation inputs missing client or internal output.");
      }
      const result = await runSemanticEvaluation({ transcriptSource, clientOutput, internalOutput });
      return normalizeEvaluatorResult(result);
    } catch (err) {
      return safeFail(`Semantic evaluator failed: ${err.message}`);
    }
  }

  module.exports = { evaluateFounderReportSemantics };
  