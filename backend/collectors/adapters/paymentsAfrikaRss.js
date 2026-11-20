const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { fetchText } = require("../httpClient");
const {
  cleanText,
  normalizeArticle,
  isRelevantPaymentsContent,
} = require("../articleNormalizer");

const FEED_URL = "https://paymentsafrika.com/feed/";
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseRssDate(value) {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const dateParts = /(?:^|,\s*)(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(value);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (dateParts) {
    const month = monthNames.findIndex((name) => name.toLowerCase() === dateParts[2].toLowerCase());
    const day = Number(dateParts[1]);
    const year = Number(dateParts[3]);
    const daysInMonth = month < 0 ? 0 : new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    if (day < 1 || day > daysInMonth) {
      return null;
    }
  }
  return new Date(timestamp);
}

function mapRssItem(item) {
  if (!item || typeof item !== "object") {
    return { article: null, reason: "invalid_rss_item" };
  }
  const publishedAt = parseRssDate(item.pubDate);
  if (item.pubDate && !publishedAt) {
    return { article: null, reason: "invalid_publication_date" };
  }
  const categories = asArray(item.category)
    .map(cleanText)
    .filter(Boolean);
  const guid = typeof item.guid === "string"
    ? item.guid
    : item.guid?.["#text"] || null;
  const result = normalizeArticle({
    adapter: "payments_afrika_rss",
    title: item.title,
    summary: item.description || item["content:encoded"] || null,
    url: item.link,
    publishedAt,
    language: "en",
    externalCategory: categories.join(", ") || null,
    externalId: guid,
    provenance: {
      feedUrl: FEED_URL,
      guid: cleanText(guid),
      categories,
      dcCreator: cleanText(item["dc:creator"]),
    },
  });
  if (result.article && !isRelevantPaymentsContent(result.article)) {
    return { article: null, reason: "outside_project_scope" };
  }
  return result;
}

async function collectPaymentsAfrika(options = {}) {
  const feedUrl = options.feedUrl || FEED_URL;
  if (new URL(feedUrl).origin !== new URL(FEED_URL).origin) {
    throw new Error("Le flux RSS Payments Afrika doit utiliser le domaine officiel configuré.");
  }
  const { body } = await fetchText(feedUrl, {
    accept: "application/rss+xml, application/xml, text/xml",
    maxBytes: 10 * 1024 * 1024,
  });
  const validation = XMLValidator.validate(body);
  if (validation !== true) {
    throw new Error("Payments Afrika a renvoyé un flux RSS XML invalide.");
  }

  let payload;
  try {
    payload = parser.parse(body);
  } catch {
    throw new Error("Payments Afrika a renvoyé un flux RSS impossible à analyser.");
  }
  const channel = payload?.rss?.channel;
  if (!channel || typeof channel !== "object") {
    throw new Error("Le flux Payments Afrika ne contient pas de canal RSS valide.");
  }
  const entries = asArray(channel.item);
  const results = entries.map(mapRssItem);
  return {
    request: { endpoint: feedUrl },
    seen: entries.length,
    items: results.map((result) => result.article).filter(Boolean),
    skipped: results.filter((result) => !result.article).length,
  };
}

module.exports = { collectPaymentsAfrika, mapRssItem, parseRssDate, FEED_URL };
