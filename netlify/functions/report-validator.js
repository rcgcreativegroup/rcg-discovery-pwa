function normalizeText(text = "") {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\u00A0/g, " ")
      .trim();
  }

  function splitInternalBlock(rawText) {
    const marker = "\u2501\u2501\u2501 INTERNAL DATA BLOCK \u2014 BEGIN \u2501\u2501\u2501";
    const idx = rawText.indexOf(marker);
    if (idx === -1) {
      return { clientOutput: rawText.trim(), internalOutput: "", hasInternalBlock: false };
    }
    return {
      clientOutput: rawText.slice(0, idx).trim(),
      internalOutput: rawText.slice(idx).trim(),
      hasInternalBlock: true,
    };
  }

  function validateFounderClientOutput(clientOutput) {
    const text = normalizeText(clientOutput);
    const requiredAnchors = [
      "Your S.O.U.L Identity Score\u2122",
      "S \u2014 Story Clarity",
      "O \u2014 Origin Depth",
      "U \u2014 Uniqueness Signal",
      "L \u2014 Legacy Intention",
      "YOUR FOUNDER ARCHETYPE SIGNAL\u2122",
      "WHAT WE NEED TO TIGHTEN",
    ];
    const forbiddenPatterns = [
      /Formation\s*:/i,
      /Path\s*:/i,
      /Mission\s*:/i,
      /Beliefs\s*:/i,
      /\[FULL VERBATIM CONTINUES/i,
      /Your session is complete\./i,
      /Your results have been sent to your email\./i,
    ];
    const missing = requiredAnchors.filter(anchor => !text.includes(anchor));
    const forbiddenHits = forbiddenPatterns
      .filter(rx => rx.test(text))
      .map(rx => rx.toString());
    return {
      valid: missing.length === 0 && forbiddenHits.length === 0,
      missing,
      forbiddenHits,
    };
  }

  module.exports = { normalizeText, splitInternalBlock, validateFounderClientOutput };
  