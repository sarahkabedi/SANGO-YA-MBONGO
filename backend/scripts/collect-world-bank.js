const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { collectWorldBank, COUNTRY_CODE, INDICATORS } = require("../collectors/adapters/worldBankApi");
const { runIndicatorCollection } = require("../services/collectionService");
const { parseExecutionMode } = require("./cliOptions");

async function main() {
  const mode = parseExecutionMode(process.argv.slice(2));
  const pool = mode === "apply" ? require("../db") : null;
  try {
    const result = await runIndicatorCollection({
      sourceCode: "world_bank",
      adapter: collectWorldBank,
      apply: mode === "apply",
      pool,
      requestParameters: {
        adapter: "world_bank_api",
        countryCode: COUNTRY_CODE,
        indicatorCodes: INDICATORS.map((indicator) => indicator.code),
      },
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (pool) await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: { code: error.code || "COLLECTION_ERROR", message: error.message },
  }, null, 2));
  process.exitCode = 1;
});
