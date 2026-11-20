function parseExecutionMode(args) {
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (dryRun && apply) {
    throw new Error("Choisissez une seule option : --dry-run ou --apply.");
  }
  return apply ? "apply" : "dry-run";
}

function optionValue(args, option) {
  const prefix = `${option}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(option);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`L’option ${option} nécessite une valeur.`);
    }
    return value;
  }
  return null;
}

function hasCollectionFailures(results) {
  return results.some((result) => result.error || result.failed > 0);
}

module.exports = { parseExecutionMode, optionValue, hasCollectionFailures };
