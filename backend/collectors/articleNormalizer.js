const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

function cleanText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (entity, number) => {
      const codePoint = Number(number);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length > 4096) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || TRACKING_PARAMETERS.has(lowerKey)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parseGdeltDate(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    return null;
  }
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) || date.toISOString() !== iso.replace(/Z$/, ".000Z")
    ? null
    : date.toISOString();
}

function normalizeArticle(item) {
  const title = cleanText(item.title);
  const originalUrl = typeof item.url === "string" ? item.url.trim() : "";
  const normalizedUrl = normalizeUrl(originalUrl);
  const summary = cleanText(item.summary);
  let publishedAt = null;
  if (item.publishedAt instanceof Date) {
    if (Number.isNaN(item.publishedAt.getTime())) {
      return { article: null, reason: "invalid_publication_date" };
    }
    publishedAt = item.publishedAt.toISOString();
  } else if (item.publishedAt !== undefined && item.publishedAt !== null && item.publishedAt !== "") {
    const timestamp = typeof item.publishedAt === "string" ? Date.parse(item.publishedAt) : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      return { article: null, reason: "invalid_publication_date" };
    }
    publishedAt = new Date(timestamp).toISOString();
  }

  if (!title || !originalUrl || !normalizedUrl) {
    return { article: null, reason: "missing_required_metadata" };
  }

  return {
    article: {
      title,
      summary,
      language: cleanText(item.language)?.slice(0, 10) || null,
      publishedAt,
      originalUrl,
      normalizedUrl,
      externalId: cleanText(item.externalId),
      externalCategory: cleanText(item.externalCategory),
      provenance: {
        adapter: item.adapter,
        sourceRecord: item.provenance || {},
        originalUrl,
        normalizedUrl,
        collectedAt: new Date().toISOString(),
      },
    },
    reason: null,
  };
}

function isRelevantPaymentsContent(article) {
  const content = `${article.title} ${article.summary || ""} ${article.externalCategory || ""}`;
  return /\b(mobile money|mobile payment|mobile payments|digital payment|digital payments|payments?|fintech|financial inclusion|digital wallet|payment system|payment service|interoperab|cashless|e-money|electronic money|fraud|mobile banking)\b/i.test(content);
}

module.exports = {
  cleanText,
  normalizeUrl,
  parseGdeltDate,
  normalizeArticle,
  isRelevantPaymentsContent,
};
