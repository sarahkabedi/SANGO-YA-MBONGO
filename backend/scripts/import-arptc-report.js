const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const {
  persistManualReport,
  summarizeManualReport,
  validateManualReport,
} = require("../services/arptcImportService");
const { optionValue, parseExecutionMode } = require("./cliOptions");

async function main() {
  const args = process.argv.slice(2);
  const mode = parseExecutionMode(args);
  const inputPath = optionValue(args, "--file");
  if (!inputPath) {
    throw new Error("Fournissez un fichier de rapport JSON avec --file <chemin>.");
  }
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const content = await fs.readFile(resolvedPath, "utf8");
  let report;
  try {
    report = JSON.parse(content);
  } catch {
    throw new Error("Le fichier de rapport ne contient pas un JSON valide.");
  }
  const validatedReport = validateManualReport(report);
  if (mode === "dry-run") {
    console.log(JSON.stringify(summarizeManualReport(validatedReport), null, 2));
    return;
  }

  const pool = require("../db");
  try {
    const result = await persistManualReport(pool, validatedReport);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: { code: error.code || "ARPTC_IMPORT_ERROR", message: error.message },
  }, null, 2));
  process.exitCode = 1;
});
