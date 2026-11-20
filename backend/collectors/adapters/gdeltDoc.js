const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fetchJson } = require("../httpClient");
const { normalizeArticle } = require("../articleNormalizer");

const MIN_REQUEST_INTERVAL_MS = 5000;
const LOCK_PATH = path.join(os.tmpdir(), "sango-ya-mbongo-gdelt.lock");
const STATE_PATH = path.join(os.tmpdir(), "sango-ya-mbongo-gdelt.json");
const DEFAULT_QUERY = '("mobile money" OR "mobile payments" OR fintech OR "digital payments") AND (Congo OR "DR Congo" OR "Democratic Republic of the Congo")';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireRateLock() {
  while (true) {
    try {
      return await fs.open(LOCK_PATH, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const stat = await fs.stat(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > 180000) {
          await fs.unlink(LOCK_PATH);
          continue;
        }
      } catch (statError) {
        if (statError.code === "ENOENT") {
          continue;
        }
        throw statError;
      }
      await sleep(200);
    }
  }
}

async function withGdeltRateLimit(operation) {
  const lock = await acquireRateLock();
  try {
    const waitForSlot = async () => {
      let lastStartedAt = 0;
      try {
        const state = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
        if (Number.isFinite(state.lastStartedAt)) {
          lastStartedAt = state.lastStartedAt;
        }
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
          throw error;
        }
      }
      const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastStartedAt);
      if (wait > 0) {
        await sleep(wait);
      }
      await fs.writeFile(
        STATE_PATH,
        JSON.stringify({ lastStartedAt: Date.now() }),
        "utf8",
      );
    };
    return await operation(waitForSlot);
  } finally {
    await lock.close();
    await fs.unlink(LOCK_PATH).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function mapGdeltResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  return normalizeArticle({
    adapter: "gdelt_doc",
    title: result.title,
    summary: result.snippet || null,
    url: result.url,
    publishedAt: null,
    language: result.language || null,
    externalCategory: result.sourcecountry || null,
    externalId: null,
    provenance: {
      domain: result.domain || null,
      sourceCountry: result.sourcecountry || null,
      sourceCollection: result.sourceCollection || null,
      seenDate: result.seendate || null,
    },
  });
}

async function collectGdelt(options = {}) {
  const query = options.query || process.env.GDELT_QUERY || DEFAULT_QUERY;
  const maxRecords = options.maxRecords || 50;
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 250) {
    throw new Error("GDELT maxRecords doit être un entier entre 1 et 250.");
  }
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("sort", "DateDesc");

  const payload = await withGdeltRateLimit(
    (beforeAttempt) => fetchJson(url, { beforeAttempt }),
  );
  if (!payload || !Array.isArray(payload.articles)) {
    throw new Error("GDELT a renvoyé une réponse sans liste « articles » valide.");
  }
  const mappedResults = payload.articles.map(mapGdeltResult);
  return {
    request: { endpoint: "GDELT DOC 2.0", query, maxRecords },
    seen: payload.articles.length,
    items: mappedResults.map((result) => result?.article).filter(Boolean),
    skipped: mappedResults.filter((result) => !result?.article).length,
  };
}

module.exports = {
  collectGdelt,
  mapGdeltResult,
  withGdeltRateLimit,
  MIN_REQUEST_INTERVAL_MS,
  DEFAULT_QUERY,
};
