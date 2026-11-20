const { fetchJson } = require("../httpClient");

const COUNTRY_CODE = "COD";
const INDICATORS = Object.freeze([
  {
    code: "FX.OWN.TOTL.ZS",
    externalName: "Account ownership at a financial institution or with a mobile-money-service provider (% of population ages 15+)",
    unit: "% de la population âgée de 15 ans et plus",
  },
]);

function parseWorldBankPayload(payload) {
  if (!Array.isArray(payload) || payload.length < 2 || !payload[0] || !Array.isArray(payload[1])) {
    throw new Error("La Banque mondiale a renvoyé une réponse API invalide.");
  }
  if (payload[0].message) {
    const message = payload[0].message.map((entry) => entry.value).filter(Boolean).join("; ");
    throw new Error(`La Banque mondiale a signalé une erreur : ${message || "réponse non disponible"}`);
  }
  return { metadata: payload[0], records: payload[1] };
}

function mapWorldBankObservation(record, indicator, countryCode = COUNTRY_CODE) {
  if (
    !record ||
    record.countryiso3code !== countryCode ||
    !/^\d{4}$/.test(String(record.date)) ||
    record.value === null ||
    typeof record.value !== "number" ||
    !Number.isFinite(record.value)
  ) {
    return null;
  }
  const year = String(record.date);
  return {
    sourceRecordKey: `${indicator.code}:${countryCode}:${year}`,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    valueRaw: String(record.value),
    unitRaw: indicator.unit,
    valueNormalized: String(record.value),
    unitNormalized: indicator.unit,
    normalizationRuleCode: "identity",
    normalizationVersion: "1",
    normalizationStatus: "normalized",
    dimensions: {},
    provenanceSnapshot: {
      provider: "World Bank API v2",
      country: countryCode,
      indicatorCode: indicator.code,
      indicatorName: record.indicator?.value || indicator.externalName,
      sourceId: record.source?.id || null,
      sourceName: record.source?.value || "World Development Indicators",
      unitMetadata: "L’API ne fournit pas de libellé d’unité pour cette série; l’unité vient de la définition officielle et du mapping local.",
      valueWasReturnedAs: "numeric API value; identity rule applied with no unit conversion",
    },
    sourceUpdatedAt: null,
  };
}

async function collectIndicator(indicator, options = {}) {
  const countryCode = options.countryCode || COUNTRY_CODE;
  const baseUrl = options.baseUrl || "https://api.worldbank.org/v2/";
  const perPage = options.perPage || 1000;
  const maxPages = options.maxPages || 100;
  const records = [];
  let metadata = null;
  let page = 1;

  while (page <= maxPages) {
    const url = new URL(
      `country/${encodeURIComponent(countryCode)}/indicator/${encodeURIComponent(indicator.code)}`,
      baseUrl,
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const parsed = parseWorldBankPayload(await fetchJson(url));
    metadata = parsed.metadata;
    records.push(...parsed.records);

    const pages = Number(parsed.metadata.pages);
    if (!Number.isInteger(pages) || pages < 1 || page >= pages) {
      break;
    }
    page += 1;
  }
  if (page > maxPages) {
    throw new Error(`La pagination World Bank dépasse la limite de sécurité de ${maxPages} pages.`);
  }

  const observations = records
    .map((record) => mapWorldBankObservation(record, indicator, countryCode))
    .filter(Boolean);
  return {
    indicator,
    request: { endpoint: "World Bank API v2", countryCode, indicatorCode: indicator.code },
    metadata,
    seen: records.length,
    items: observations,
    skipped: records.length - observations.length,
  };
}

async function collectWorldBank(options = {}) {
  const indicators = options.indicators || INDICATORS;
  const results = [];
  for (const indicator of indicators) {
    results.push(await collectIndicator(indicator, options));
  }
  return {
    request: { countryCode: options.countryCode || COUNTRY_CODE },
    seen: results.reduce((sum, result) => sum + result.seen, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    items: results.flatMap((result) => result.items),
    indicators: results,
  };
}

module.exports = {
  collectWorldBank,
  collectIndicator,
  mapWorldBankObservation,
  parseWorldBankPayload,
  INDICATORS,
  COUNTRY_CODE,
};
