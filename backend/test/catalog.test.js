const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const createApp = require("../app");

async function requestWithPool(t, pool, path, init) {
  const server = createApp({ pool }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
  return { response, body: await response.json() };
}

function createFakePool(queryHandler) {
  const calls = [];
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text, values });
      return queryHandler(text, values);
    },
  };
}

test("les routes d’accueil, de santé, des sources, catégories et indicateurs répondent", async (t) => {
  const pool = createFakePool(async (sql) => {
    if (sql.includes("SELECT 1")) return { rows: [{ "?column?": 1 }] };
    if (sql.includes("FROM sources")) return { rows: [{ id: "1", code: "gdelt" }] };
    if (sql.includes("FROM categories")) return { rows: [{ id: "2", slug: "paiements" }] };
    if (sql.includes("FROM indicators")) return { rows: [{ id: "3", code: "mobile_money" }] };
    throw new Error("Requête inattendue dans le test");
  });

  const root = await requestWithPool(t, pool, "/", {
    headers: { Accept: "application/json" },
  });
  assert.equal(root.response.status, 200);
  assert.equal(root.body.status, "API opérationnelle");

  const health = await requestWithPool(t, pool, "/api/health");
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { api: "OK", database: "Connected" });
  assert.ok(pool.calls.some(({ text }) => text === "SELECT 1"));

  const sources = await requestWithPool(t, pool, "/api/sources");
  assert.deepEqual(sources.body.data, [{ id: "1", code: "gdelt" }]);

  const categories = await requestWithPool(t, pool, "/api/categories");
  assert.deepEqual(categories.body.data, [{ id: "2", slug: "paiements" }]);

  const indicators = await requestWithPool(t, pool, "/api/indicators");
  assert.deepEqual(indicators.body.data, [{ id: "3", code: "mobile_money" }]);
});

test("Express sert la page d’accueil et les ressources des pages frontend", async (t) => {
  const server = createApp({ pool: createFakePool(async () => ({ rows: [] })) })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const homeResponse = await fetch(`${baseUrl}/`, { headers: { Accept: "*/*" } });
  assert.equal(homeResponse.status, 200);
  assert.match(homeResponse.headers.get("content-type"), /text\/html/);
  assert.match(await homeResponse.text(), /Comprendre aujourd'hui/);

  for (const resource of [
    "/pages/actualites.html",
    "/pages/article.html",
    "/pages/tableau-de-bord.html",
    "/pages/connexion.html",
    "/pages/inscription.html",
    "/pages/favoris.html",
    "/css/style.css",
    "/js/script.js",
    "/assets/logo-sango.svg",
    "/assets/illustration-paiements.svg",
    "/assets/categorie-mobile-money.svg",
    "/assets/categorie-paiements-marchands.svg",
    "/assets/categorie-interoperabilite.svg",
    "/assets/categorie-securite.svg",
  ]) {
    const response = await fetch(`${baseUrl}${resource}`);
    assert.equal(response.status, 200, resource);
    assert.ok(Number(response.headers.get("content-length")) > 0, resource);
  }

  const unavailableAccount = await fetch(`${baseUrl}/pages/connexion.html`);
  assert.match(await unavailableAccount.text(), /n'est pas encore disponible/);
});

test("la recherche et les filtres d’articles sont transmis comme paramètres SQL", async (t) => {
  const pool = createFakePool(async (sql) => {
    if (sql.includes("COUNT(*)")) return { rows: [{ total: "1" }] };
    return {
      rows: [{
        id: "9",
        title: "Actualité",
        category: { id: "2", slug: "paiements" },
        sources: [],
      }],
    };
  });

  const result = await requestWithPool(
    t,
    pool,
    "/api/articles?q=mobile%25_&category=paiements&source=gdelt&from=2025-01-01&to=2025-01-31&page=2&limit=5",
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.pagination.page, 2);
  assert.equal(result.body.pagination.totalPages, 1);
  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[0].text, /a\.title ILIKE \$1 ESCAPE '!'/);
  assert.match(pool.calls[0].text, /fc\.slug = \$3/);
  assert.match(pool.calls[0].text, /fs\.code = \$4/);
  assert.deepEqual(pool.calls[0].values, [
    "%mobile!%!_%",
    "%mobile!%!_%",
    "paiements",
    "gdelt",
    "2025-01-01",
    "2025-01-31",
  ]);
  assert.deepEqual(pool.calls[1].values.slice(-2), [5, 5]);
  assert.match(pool.calls[1].text, /article_url_aliases/);
});

test("les dates invalides et les identifiants invalides sont rejetés", async (t) => {
  let queryCount = 0;
  const pool = createFakePool(async () => {
    queryCount += 1;
    return { rows: [] };
  });

  const badDate = await requestWithPool(t, pool, "/api/articles?from=2025-02-30");
  assert.equal(badDate.response.status, 400);
  assert.equal(badDate.body.error.code, "INVALID_DATE");

  const badId = await requestWithPool(t, pool, "/api/articles/1.5");
  assert.equal(badId.response.status, 400);
  assert.equal(badId.body.error.code, "INVALID_ID");
  assert.equal(queryCount, 0);
});

test("les détails d’articles et d’indicateurs renvoient 404 si absents", async (t) => {
  const pool = createFakePool(async () => ({ rows: [] }));

  const article = await requestWithPool(t, pool, "/api/articles/42");
  assert.equal(article.response.status, 404);
  assert.equal(article.body.error.code, "ARTICLE_NOT_FOUND");

  const indicator = await requestWithPool(t, pool, "/api/indicators/43");
  assert.equal(indicator.response.status, 404);
  assert.equal(indicator.body.error.code, "INDICATOR_NOT_FOUND");
});

test("les détails présents comprennent les provenances et les observations normalisées", async (t) => {
  const pool = createFakePool(async (sql) => {
    if (sql.includes("FROM articles AS a")) {
      return { rows: [{ id: "8", title: "Article", sources: [] }] };
    }
    if (sql.includes("FROM indicators")) {
      return { rows: [{ id: "3", code: "mobile_money" }] };
    }
    if (sql.includes("COUNT(*)")) return { rows: [{ total: "1" }] };
    if (sql.includes("FROM indicator_observations")) {
      return { rows: [{ id: "11", value_normalized: "12.5", source_id: "1" }] };
    }
    throw new Error("Requête inattendue dans le test");
  });

  const article = await requestWithPool(t, pool, "/api/articles/8");
  assert.equal(article.response.status, 200);
  assert.equal(article.body.data.id, "8");

  const indicator = await requestWithPool(t, pool, "/api/indicators/3");
  assert.equal(indicator.response.status, 200);
  assert.equal(indicator.body.data.observations.data[0].value_normalized, "12.5");
  assert.equal(indicator.body.data.observations.pagination.total, 1);
  assert.ok(pool.calls.some(({ text }) => text.includes("source_documents")));
  const observationQuery = pool.calls.find(({ text }) => text.includes("observation.period_start::TEXT"));
  assert.ok(observationQuery);
  assert.match(observationQuery.text, /observation\.period_start::TEXT AS period_start/);
  assert.match(observationQuery.text, /observation\.period_end::TEXT AS period_end/);
  assert.match(observationQuery.text, /source\.homepage_url AS source_homepage_url/);
});

test("les erreurs inattendues ne révèlent pas les détails de la base", async (t) => {
  const pool = createFakePool(async () => {
    const error = new Error("détail confidentiel");
    error.code = "XX000";
    throw error;
  });
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });

  const result = await requestWithPool(t, pool, "/api/sources");
  assert.equal(result.response.status, 500);
  assert.deepEqual(result.body, {
    error: { code: "INTERNAL_ERROR", message: "Une erreur interne est survenue." },
  });
});
