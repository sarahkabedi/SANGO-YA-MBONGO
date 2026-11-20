const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  cleanText,
  normalizeArticle,
  normalizeUrl,
  parseGdeltDate,
} = require("../collectors/articleNormalizer");
const { mapGdeltResult, MIN_REQUEST_INTERVAL_MS } = require("../collectors/adapters/gdeltDoc");
const {
  mapRssItem,
  parseRssDate,
  FEED_URL,
} = require("../collectors/adapters/paymentsAfrikaRss");
const {
  mapWorldBankObservation,
  parseWorldBankPayload,
  INDICATORS,
  COUNTRY_CODE,
} = require("../collectors/adapters/worldBankApi");
const {
  persistArticle,
  persistObservationInTransaction,
  runNewsCollection,
  withTransaction,
} = require("../services/collectionService");
const { validateManualReport } = require("../services/arptcImportService");
const {
  hasCollectionFailures,
  optionValue,
  parseExecutionMode,
} = require("../scripts/cliOptions");

const seedSql = fs.readFileSync(
  path.join(__dirname, "..", "..", "database", "seed.sql"),
  "utf8",
);
const verificationSql = fs.readFileSync(
  path.join(__dirname, "..", "..", "database", "verify-seed.sql"),
  "utf8",
);
const newsVerificationSql = fs.readFileSync(
  path.join(__dirname, "..", "..", "database", "verify-news-collection.sql"),
  "utf8",
);
const repairEncodingSql = fs.readFileSync(
  path.join(__dirname, "..", "..", "database", "repair-seed-text-encoding.sql"),
  "utf8",
);

test("le seed ignore les conflits de métadonnées et préserve les états désactivés", () => {
  const conflictClauses = seedSql.match(/ON CONFLICT[\s\S]*?DO (?:NOTHING|UPDATE)[\s\S]*?;/g) || [];
  assert.equal(conflictClauses.length, 5);
  for (const clause of conflictClauses) {
    assert.match(clause, /DO NOTHING;/);
    assert.doesNotMatch(clause, /DO UPDATE/);
  }
  assert.match(seedSql, /'gdelt_doc',\s*'GDELT DOC 2\.0',\s*'news_api',\s*'gdelt_doc'/);
  assert.match(seedSql, /'payments_afrika',\s*'Payments Afrika',\s*'rss',\s*'payments_afrika_rss'/);
  assert.match(seedSql, /'world_bank',\s*'Banque mondiale',\s*'statistics_api',\s*'world_bank_api'/);
  assert.match(seedSql, /'arptc',\s*'Autorité de Régulation[\s\S]*?',\s*'institutional',\s*'arptc_manual'/);
  const categoriesBlock = seedSql.match(
    /INSERT INTO categories[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/,
  )?.[1];
  assert.ok(categoriesBlock);
  assert.equal((categoriesBlock.match(/^\s*\('/gm) || []).length, 8);
});

test("le seed interrompt sa transaction si le mapping World Bank vise un autre indicateur", () => {
  assert.match(seedSql, /^SET client_encoding TO 'UTF8';\s*BEGIN;/);
  assert.match(seedSql, /ON CONFLICT \(source_id, external_code\) DO NOTHING;/);
  assert.match(seedSql, /DO \$seed_validation\$[\s\S]*?RAISE EXCEPTION[\s\S]*?different indicator[\s\S]*?\$seed_validation\$;/);
  assert.match(
    seedSql,
    /source\.code = 'world_bank'[\s\S]*?mapping\.external_code = 'FX\.OWN\.TOTL\.ZS'[\s\S]*?indicator\.code <> 'FX\.OWN\.TOTL\.ZS'/,
  );
  assert.match(seedSql, /BEGIN;[\s\S]*?DO \$seed_validation\$[\s\S]*?COMMIT;/);
});

test("la réparation d’encodage est ciblée, idempotente et transactionnelle", () => {
  assert.match(repairEncodingSql, /^SET client_encoding TO 'UTF8';\s*BEGIN;/);
  assert.match(repairEncodingSql, /COMMIT;\s*$/);
  assert.match(repairEncodingSql, /position\(U&'\\00C3' IN name\) > 0/);
  assert.doesNotMatch(repairEncodingSql, /position\(U&'\\00E2'/);
  assert.match(repairEncodingSql, /code = 'FX\.OWN\.TOTL\.ZS'/);
  assert.match(repairEncodingSql, /code = 'COD'/);
  assert.doesNotMatch(repairEncodingSql, /\b(articles|article_sources|article_url_aliases|indicator_observations)\b/i);
});

test("la vérification post-seed est en lecture seule et couvre toutes les références attendues", () => {
  assert.match(verificationSql, /^\s*WITH\b/i);
  assert.doesNotMatch(verificationSql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.match(verificationSql, /'gdelt_doc'/);
  assert.match(verificationSql, /'payments_afrika'/);
  assert.match(verificationSql, /'world_bank'/);
  assert.match(verificationSql, /'arptc'/);
  assert.match(verificationSql, /'education-financiere'/);
  assert.match(verificationSql, /'ISO-3166-1-alpha-3'[\s\S]*?'COD'/);
  assert.match(verificationSql, /'FX\.OWN\.TOTL\.ZS'/);
  assert.match(verificationSql, /indicator\.code = 'FX\.OWN\.TOTL\.ZS'/);
});

test("la vérification des actualités compte en lecture seule par source et statut", () => {
  assert.match(newsVerificationSql, /\bWITH expected_statuses\b/i);
  assert.doesNotMatch(newsVerificationSql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.match(newsVerificationSql, /source\.is_enabled/);
  assert.match(newsVerificationSql, /article_sources/);
  assert.match(newsVerificationSql, /article_url_aliases/);
  assert.match(newsVerificationSql, /COUNT\s*\(\s*DISTINCT article\.id\s*\)/i);
  assert.match(newsVerificationSql, /'pending_review'/);
  assert.match(newsVerificationSql, /'published'/);
  assert.match(newsVerificationSql, /'hidden'/);
});

test("les URL normalisées suppriment les paramètres de suivi sans changer la cible", () => {
  assert.equal(
    normalizeUrl("https://News.Example/path/?utm_source=letter&b=2&fbclid=track#section"),
    "https://news.example/path?b=2",
  );
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
});

test("les contenus textuels et dates sont normalisés sans inventer de date", () => {
  assert.equal(cleanText("  <p>Mobile&nbsp; money &amp; paiements</p> "), "Mobile money & paiements");
  assert.equal(parseGdeltDate("20261120T041500Z"), "2026-11-20T04:15:00.000Z");
  assert.equal(parseGdeltDate("20260231T041500Z"), null);
  const result = normalizeArticle({
    title: "Titre",
    url: "https://example.org/article",
    publishedAt: null,
  });
  assert.equal(result.article.publishedAt, null);
  const invalidDate = normalizeArticle({
    title: "Titre",
    url: "https://example.org/article",
    publishedAt: "date-invalide",
  });
  assert.equal(invalidDate.article, null);
  assert.equal(invalidDate.reason, "invalid_publication_date");
});

test("l’adaptateur GDELT ne confond pas sa date d’observation avec la date de publication", () => {
  const result = mapGdeltResult({
    title: "Titre",
    url: "https://example.org/article",
    seendate: "20261120T041500Z",
  });
  assert.equal(result.article.publishedAt, null);
  assert.equal(result.article.provenance.sourceRecord.seenDate, "20261120T041500Z");
  assert.equal(MIN_REQUEST_INTERVAL_MS, 5000);
});

test("l’adaptateur RSS utilise le flux public retenu et rejette les éléments incomplets", () => {
  assert.equal(FEED_URL, "https://paymentsafrika.com/feed/");
  const result = mapRssItem({ title: "Entrée sans URL ni date" });
  assert.equal(result.article, null);
  assert.equal(parseRssDate("Fri, 20 Nov 2026 04:37:59 +0000")?.toISOString(), "2026-11-20T04:37:59.000Z");
  assert.equal(parseRssDate("Mon, 32 Nov 2026 04:37:59 +0000"), null);
});

test("le mapping World Bank conserve COD, ignore null et ne convertit pas les valeurs", () => {
  assert.equal(COUNTRY_CODE, "COD");
  assert.equal(INDICATORS.length, 1);
  assert.equal(
    mapWorldBankObservation({
      countryiso3code: "COD",
      date: "2021",
      value: null,
    }, INDICATORS[0]),
    null,
  );
  const observation = mapWorldBankObservation({
    countryiso3code: "COD",
    date: "2021",
    value: 21.75,
    indicator: { value: "Account ownership" },
  }, INDICATORS[0]);
  assert.equal(observation.valueRaw, "21.75");
  assert.equal(observation.valueNormalized, "21.75");
  assert.equal(observation.unitRaw, observation.unitNormalized);
  assert.equal(observation.normalizationRuleCode, "identity");
  assert.equal(observation.sourceRecordKey, "FX.OWN.TOTL.ZS:COD:2021");
  assert.throws(() => parseWorldBankPayload({}), /réponse API invalide/);
});

test("le mode dry-run n’a pas besoin de pool et ne persiste aucune donnée", async () => {
  let fetched = false;
  const result = await runNewsCollection({
    sourceCode: "gdelt_doc",
    adapter: async () => {
      fetched = true;
      return { request: {}, seen: 0, items: [], skipped: 0 };
    },
  });
  assert.equal(fetched, true);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.inserted, 0);
  assert.equal(result.candidates, 0);
});

test("les erreurs d’article restent isolées, détaillées sans secrets et distinctes des éléments ignorés", async () => {
  const transactionStatements = [];
  let connection = 0;
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT id") && sql.includes("FROM sources")) {
        return { rows: [{ id: "4" }] };
      }
      if (sql.includes("INSERT INTO collection_logs")) return { rows: [{ id: "91" }] };
      return { rows: [] };
    },
    async connect() {
      connection += 1;
      const currentConnection = connection;
      return {
        async query(sql, values = []) {
          transactionStatements.push(sql);
          if (sql === "SELECT id, article_id") return { rows: [] };
          if (sql.includes("FROM article_url_aliases")) return { rows: [] };
          if (sql.includes("INSERT INTO articles") && values[0] === "Article en erreur") {
            const error = new Error("api_key=DO_NOT_DISPLAY");
            error.code = "23514";
            throw error;
          }
          if (sql.includes("INSERT INTO articles")) return { rows: [{ id: "12" }] };
          if (sql.includes("INSERT INTO article_url_aliases")) {
            return { rows: [{ id: "18", article_id: "12" }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const result = await runNewsCollection({
    sourceCode: "payments_afrika",
    apply: true,
    pool,
    adapter: async () => ({
      seen: 3,
      skipped: 1,
      items: [
        {
          title: "Article en erreur",
          originalUrl: "https://paymentsafrika.com/a?api_key=DO_NOT_DISPLAY",
          normalizedUrl: "https://paymentsafrika.com/a",
        },
        {
          title: "Article enregistré",
          originalUrl: "https://paymentsafrika.com/b",
          normalizedUrl: "https://paymentsafrika.com/b",
        },
      ],
    }),
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.ignored, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.errors[0].title, "Article en erreur");
  assert.equal(result.errors[0].sourceUrl, "https://paymentsafrika.com/a");
  assert.equal(result.errors[0].code, "23514");
  assert.match(result.errors[0].message, /règle de validation/);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_DISPLAY|api_key/);
  assert.ok(transactionStatements.includes("ROLLBACK"));
  assert.ok(transactionStatements.includes("COMMIT"));
  assert.equal(hasCollectionFailures([result]), true);
});

test("la persistance d’un article paramètre le contenu et commence en revue", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM article_url_aliases")) return { rows: [] };
      if (sql.includes("INSERT INTO articles")) return { rows: [{ id: "12" }] };
      if (sql.includes("INSERT INTO article_url_aliases")) {
        return { rows: [{ id: "18", article_id: "12" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const result = await persistArticle(pool, "4", {
    title: "Titre collecté",
    summary: "Résumé",
    language: "fr",
    publishedAt: "2026-01-02T03:04:05.000Z",
    originalUrl: "https://example.org/article?utm_source=feed",
    normalizedUrl: "https://example.org/article",
    externalId: null,
    externalCategory: null,
  });
  assert.equal(result.inserted, true);
  const articleInsert = calls.find(({ sql }) => sql.includes("INSERT INTO articles"));
  assert.deepEqual(articleInsert.values, [
    "Titre collecté",
    "Résumé",
    "fr",
    "2026-01-02T03:04:05.000Z",
  ]);
  assert.match(articleInsert.sql, /'pending_review', 'unclassified'/);
});

test("l’upsert d’observation conserve l’ordre et le paramétrage des 21 valeurs", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("INSERT INTO indicator_observations")) return { rows: [{ id: "7" }] };
      throw new Error("Un conflit ne devait pas entraîner une mise à jour.");
    },
  };
  const result = await persistObservationInTransaction(
    client,
    { source_id: "2", mapping_id: "5", geography_id: "1" },
    {
      periodStart: "2021-01-01",
      periodEnd: "2021-12-31",
      valueRaw: "19.25",
      unitRaw: "% de la population",
      valueNormalized: "19.25",
      unitNormalized: "% de la population",
      normalizationRuleCode: "identity",
      normalizationVersion: "1",
      normalizationStatus: "normalized",
      dimensions: {},
      provenanceSnapshot: { indicator: "FX.OWN.TOTL.ZS" },
      sourceRecordKey: "FX.OWN.TOTL.ZS:COD:2021",
    },
  );
  assert.equal(result.inserted, true);
  assert.equal(calls[0].values.length, 21);
  assert.equal(calls[0].values[5], "19.25");
  assert.equal(calls[0].values[20], null);
  assert.match(calls[0].sql, /ON CONFLICT ON CONSTRAINT indicator_observations_logical_unique/);
});

test("les transactions réessaient une fois les deadlocks et erreurs de sérialisation", async () => {
  let connectionCount = 0;
  const pool = {
    async connect() {
      connectionCount += 1;
      const current = connectionCount;
      return {
        async query(sql) {
          if (current === 1 && sql === "COMMIT") {
            const error = new Error("deadlock");
            error.code = "40P01";
            throw error;
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const result = await withTransaction(pool, async () => "ok");
  assert.equal(result, "ok");
  assert.equal(connectionCount, 2);
});

test("l’option d’écriture est toujours explicite et incompatible avec dry-run", () => {
  assert.equal(parseExecutionMode([]), "dry-run");
  assert.equal(parseExecutionMode(["--dry-run"]), "dry-run");
  assert.equal(parseExecutionMode(["--apply"]), "apply");
  assert.throws(() => parseExecutionMode(["--apply", "--dry-run"]), /une seule option/);
  assert.equal(optionValue(["--source", "gdelt_doc"], "--source"), "gdelt_doc");
  assert.equal(hasCollectionFailures([{ failed: 1 }]), true);
  assert.equal(hasCollectionFailures([{ failed: 0 }]), false);
});

test("l’import ARPTC refuse un manifeste qui n’est pas un rapport structuré", () => {
  assert.throws(() => validateManualReport({}), /document/);
  assert.throws(() => validateManualReport({
    document: { title: "Rapport", originalUrl: "file:///local" },
    observations: [],
  }), /URL originale HTTP ou HTTPS valide/);
});
