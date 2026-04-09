const {
    splitInternalBlock,
    validateFounderClientOutput,
  } = require("./report-validator");

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function generateFounderReportWithRetry({
    threadId,
    assistantId,
    createRun,
    waitForRunCompletion,
    getFinalAssistantMessage,
    addUserMessageToThread,
    maxAttempts = 2,
  }) {
    let lastFailure = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { runId } = await createRun({ threadId, assistantId });
      await waitForRunCompletion({ threadId, runId });

      const rawFinalAssistantText = await getFinalAssistantMessage({ threadId });
      const { clientOutput, internalOutput, hasInternalBlock } =
        splitInternalBlock(rawFinalAssistantText);

      const validation = validateFounderClientOutput(clientOutput);

      if (validation.valid) {
        return {
          ok: true,
          attempt,
          rawFinalAssistantText,
          clientOutput,
          internalOutput,
          hasInternalBlock,
          validation,
        };
      }

      lastFailure = {
        attempt,
        rawFinalAssistantText,
        clientOutput,
        internalOutput,
        hasInternalBlock,
        validation,
      };

      if (attempt < maxAttempts) {
        await addUserMessageToThread({
          threadId,
          content:
            "FORMAT CORRECTION: The previous output was invalid. Regenerate using Knowledge Doc 03 exactly. Use S / O / U / L categories only. Include all required sections and full client template.",
        });
      }
    }

    return { ok: false, ...lastFailure };
  }

  module.exports = { generateFounderReportWithRetry };
  