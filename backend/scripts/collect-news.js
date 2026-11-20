const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { collectGdelt, DEFAULT_QUERY } = require("../collectors/adapters/gdeltDoc");
const { collectPaymentsAfrika } = require("../collectors/adapters/paymentsAfrikaRss");
const {
  runNewsCollection,
  getErrorCode,
  getSafeErrorSummary,
} = require("../services/collectionService");
const { optionValue, parseExecutionMode, hasCollectionFailures } = require("./cliOptions");

const SOURCES = {
  gdelt_doc: collectGdelt,
  payments_afrika: collectPaymentsAfrika,
};

async function main() {
  const args = process.argv.slice(2);
  const mode = parseExecutionMode(args);
  const requestedSource = optionValue(args, "--source") || "all";
  const sourceCodes = requestedSource === "all" ? Object.keys(SOURCES) : [requestedSource];
  const unknown = sourceCodes.find((sourceCode) => !SOURCES[sourceCode]);
  if (unknown) {
    throw new Error(`Source « ${unknown} » inconnue. Valeurs possibles : all, ${Object.keys(SOURCES).join(", ")}.`);
  }

  const pool = mode === "apply" ? require("../db") : null;
  const results = [];
  let hasFailures = false;
  try {
    for (const sourceCode of sourceCodes) {
      try {
        const result = await runNewsCollection({
          sourceCode,
          adapter: SOURCES[sourceCode],
          apply: mode === "apply",
          pool,
          requestParameters: sourceCode === "gdelt_doc"
            ? {
              adapter: sourceCode,
              endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
              query: process.env.GDELT_QUERY || DEFAULT_QUERY,
            }
            : {
              adapter: sourceCode,
              endpoint: "https://paymentsafrika.com/feed/",
            },
        });
        results.push(result);
        if (result.failed > 0) hasFailures = true;
      } catch (error) {
        hasFailures = true;
        results.push({
          mode,
          source: sourceCode,
          error: {
            code: getErrorCode(error),
            message: getSafeErrorSummary(error),
          },
        });
      }
    }
  } finally {
    if (pool) await pool.end();
  }

  console.log(JSON.stringify({ mode, results }, null, 2));
  if (hasFailures || hasCollectionFailures(results)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(getSafeErrorSummary(error));
  process.exitCode = 1;
});
