const catalogService = require("../services/catalogService");

const MAX_BIGINT = 9223372036854775807n;
const MAX_LIMIT = 100;
const MAX_PAGE = 1000000;

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function queryValue(query, name, res) {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    sendError(res, 400, "INVALID_QUERY", `Le paramètre « ${name} » doit apparaître une seule fois.`);
    return null;
  }
  return value;
}

function readPagination(query, res) {
  const pageValue = queryValue(query, "page", res);
  if (pageValue === null) return null;
  const limitValue = queryValue(query, "limit", res);
  if (limitValue === null) return null;

  const page = pageValue === undefined ? 1 : Number(pageValue);
  const limit = limitValue === undefined ? 20 : Number(limitValue);
  if (
    (pageValue !== undefined && !/^\d+$/.test(pageValue)) ||
    (limitValue !== undefined && !/^\d+$/.test(limitValue)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > MAX_PAGE ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    sendError(
      res,
      400,
      "INVALID_PAGINATION",
      `La page doit être comprise entre 1 et ${MAX_PAGE}, et la limite entre 1 et ${MAX_LIMIT}.`,
    );
    return null;
  }

  return { page, limit, offset: (page - 1) * limit };
}

function readDate(query, name, res) {
  const value = queryValue(query, name, res);
  if (value === null || value === undefined) {
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    sendError(res, 400, "INVALID_DATE", `Le paramètre « ${name} » doit être une date au format AAAA-MM-JJ.`);
    return null;
  }
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (value.startsWith("0000-")) {
    sendError(res, 400, "INVALID_DATE", `Le paramètre « ${name} » ne correspond pas à une date valide.`);
    return null;
  }
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
    sendError(res, 400, "INVALID_DATE", `Le paramètre « ${name} » ne correspond pas à une date valide.`);
    return null;
  }
  return value;
}

function readFilter(query, name, res, maxLength) {
  const rawValue = queryValue(query, name, res);
  if (rawValue === null || rawValue === undefined) {
    return rawValue;
  }
  const value = rawValue.trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    sendError(res, 400, "INVALID_FILTER", `Le paramètre « ${name} » est vide ou invalide.`);
    return null;
  }
  if (/^(category|source)$/.test(name) && /^\d+$/.test(value)) {
    try {
      const numericId = BigInt(value);
      if (numericId < 1n || numericId > MAX_BIGINT) {
        sendError(res, 400, "INVALID_FILTER", `Le filtre « ${name} » doit être un identifiant valide.`);
        return null;
      }
    } catch {
      sendError(res, 400, "INVALID_FILTER", `Le filtre « ${name} » doit être un identifiant valide.`);
      return null;
    }
  }
  return value;
}

function readId(value, res) {
  if (!/^[1-9]\d*$/.test(value)) {
    sendError(res, 400, "INVALID_ID", "L’identifiant doit être un entier positif.");
    return null;
  }
  try {
    if (BigInt(value) > MAX_BIGINT) {
      sendError(res, 400, "INVALID_ID", "L’identifiant dépasse la valeur maximale autorisée.");
      return null;
    }
  } catch {
    sendError(res, 400, "INVALID_ID", "L’identifiant doit être un entier positif.");
    return null;
  }
  return value;
}

function createCatalogController(pool) {
  return {
    async getSources(req, res) {
      const data = await catalogService.listSources(pool);
      res.json({ data });
    },

    async getCategories(req, res) {
      const data = await catalogService.listCategories(pool);
      res.json({ data });
    },

    async getArticles(req, res) {
      const pagination = readPagination(req.query, res);
      if (!pagination) return;

      const q = readFilter(req.query, "q", res, 200);
      if (q === null) return;
      const category = readFilter(req.query, "category", res, 100);
      if (category === null) return;
      const source = readFilter(req.query, "source", res, 100);
      if (source === null) return;
      const from = readDate(req.query, "from", res);
      if (from === null) return;
      const to = readDate(req.query, "to", res);
      if (to === null) return;
      if (from && to && from > to) {
        sendError(res, 400, "INVALID_DATE_RANGE", "La date « from » doit précéder ou égaler « to ».");
        return;
      }

      const result = await catalogService.listArticles(
        pool,
        { q, category, source, from, to },
        pagination,
      );
      res.json({
        data: result.rows,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / pagination.limit),
        },
      });
    },

    async getArticle(req, res) {
      const id = readId(req.params.id, res);
      if (!id) return;
      const article = await catalogService.getArticleById(pool, id);
      if (!article) {
        sendError(res, 404, "ARTICLE_NOT_FOUND", "Article introuvable.");
        return;
      }
      res.json({ data: article });
    },

    async getIndicators(req, res) {
      const data = await catalogService.listIndicators(pool);
      res.json({ data });
    },

    async getIndicator(req, res) {
      const id = readId(req.params.id, res);
      if (!id) return;
      const pagination = readPagination(req.query, res);
      if (!pagination) return;

      const result = await catalogService.getIndicatorById(pool, id, pagination);
      if (!result) {
        sendError(res, 404, "INDICATOR_NOT_FOUND", "Indicateur introuvable.");
        return;
      }
      res.json({
        data: {
          ...result.indicator,
          observations: {
            data: result.observations,
            pagination: {
              page: pagination.page,
              limit: pagination.limit,
              total: result.totalObservations,
              totalPages: Math.ceil(result.totalObservations / pagination.limit),
            },
          },
        },
      });
    },
  };
}

module.exports = createCatalogController;
