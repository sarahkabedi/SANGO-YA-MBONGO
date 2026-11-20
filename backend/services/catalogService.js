const ARTICLE_FROM = `
  FROM articles AS a
  LEFT JOIN categories AS c ON c.id = a.category_id
`;

function buildArticleFilters(filters) {
  const clauses = ["a.publication_status = 'published'"];
  const values = [];

  function addFilter(clause, value) {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  }

  if (filters.q) {
    const escapedQuery = filters.q.replace(/[!%_]/g, "!$&");
    const pattern = `%${escapedQuery}%`;
    values.push(pattern, pattern);
    clauses.push(
      `(a.title ILIKE $${values.length - 1} ESCAPE '!' OR a.summary ILIKE $${values.length} ESCAPE '!')`,
    );
  }

  if (filters.category) {
    if (/^\d+$/.test(filters.category)) {
      addFilter("a.category_id = ?::BIGINT", filters.category);
    } else {
      addFilter(
        "EXISTS (SELECT 1 FROM categories AS fc WHERE fc.id = a.category_id AND fc.slug = ?)",
        filters.category,
      );
    }
  }

  if (filters.source) {
    const sourceCondition = /^\d+$/.test(filters.source)
      ? "fs.id = ?::BIGINT"
      : "fs.code = ?";
    addFilter(
      `EXISTS (
        SELECT 1
          FROM article_sources AS fas
          JOIN article_url_aliases AS fua
            ON fua.id = fas.article_url_alias_id
          JOIN sources AS fs ON fs.id = fas.source_id
         WHERE fua.article_id = a.id
           AND ${sourceCondition}
      )`,
      filters.source,
    );
  }

  if (filters.from) {
    addFilter(
      "a.published_at >= (?::DATE::TIMESTAMP AT TIME ZONE 'UTC')",
      filters.from,
    );
  }

  if (filters.to) {
    addFilter(
      "a.published_at < (((?::DATE + 1)::TIMESTAMP) AT TIME ZONE 'UTC')",
      filters.to,
    );
  }

  return { where: clauses.join("\n    AND "), values };
}

function articleProvenancesLateral() {
  return `
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', provenance.id,
            'code', provenance.code,
            'name', provenance.name,
            'type', provenance.source_type,
            'originalUrls', provenance.original_urls
          )
          ORDER BY provenance.name, provenance.id
        ),
        '[]'::JSONB
      ) AS items
      FROM (
        SELECT
          s.id,
          s.code,
          s.name,
          s.source_type,
          jsonb_agg(DISTINCT article_source.original_url ORDER BY article_source.original_url)
            AS original_urls
        FROM article_sources AS article_source
        JOIN article_url_aliases AS alias
          ON alias.id = article_source.article_url_alias_id
        JOIN sources AS s ON s.id = article_source.source_id
        WHERE alias.article_id = a.id
        GROUP BY s.id, s.code, s.name, s.source_type
      ) AS provenance
    ) AS source_data ON TRUE
  `;
}

async function listSources(pool) {
  const result = await pool.query(`
    SELECT id, code, name, source_type, homepage_url
      FROM sources
     WHERE is_enabled = TRUE
     ORDER BY name, id
  `);
  return result.rows;
}

async function listCategories(pool) {
  const result = await pool.query(`
    SELECT id, name, slug, description
      FROM categories
     WHERE is_active = TRUE
     ORDER BY name, id
  `);
  return result.rows;
}

async function listArticles(pool, filters, pagination) {
  const { where, values } = buildArticleFilters(filters);
  const countResult = await pool.query(
    `SELECT COUNT(*)::BIGINT AS total
       ${ARTICLE_FROM}
      WHERE ${where}`,
    values,
  );
  const total = Number(countResult.rows[0].total);

  const pageValues = [...values, pagination.limit, pagination.offset];
  const limitParameter = pageValues.length - 1;
  const offsetParameter = pageValues.length;
  const result = await pool.query(
    `SELECT
        a.id,
        a.title,
        a.summary,
        a.language,
        a.published_at,
        a.collected_at,
        CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug
        ) END AS category,
        source_data.items AS sources
       ${ARTICLE_FROM}
       ${articleProvenancesLateral()}
      WHERE ${where}
      ORDER BY a.published_at DESC NULLS LAST, a.id DESC
      LIMIT $${limitParameter}
      OFFSET $${offsetParameter}`,
    pageValues,
  );

  return { rows: result.rows, total };
}

async function getArticleById(pool, id) {
  const result = await pool.query(
    `SELECT
        a.id,
        a.title,
        a.summary,
        a.language,
        a.published_at,
        a.collected_at,
        CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug
        ) END AS category,
        source_data.items AS sources
       ${ARTICLE_FROM}
       ${articleProvenancesLateral()}
      WHERE a.id = $1::BIGINT
        AND a.publication_status = 'published'`,
    [id],
  );
  return result.rows[0] || null;
}

async function listIndicators(pool) {
  const result = await pool.query(`
    SELECT id, code, name, definition, unit, frequency
      FROM indicators
     WHERE is_active = TRUE
     ORDER BY name, id
  `);
  return result.rows;
}

async function getIndicatorById(pool, id, pagination) {
  const indicatorResult = await pool.query(
    `SELECT id, code, name, definition, unit, frequency
       FROM indicators
      WHERE id = $1::BIGINT
        AND is_active = TRUE`,
    [id],
  );

  if (indicatorResult.rows.length === 0) {
    return null;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::BIGINT AS total
       FROM indicator_observations AS observation
       JOIN source_indicator_mappings AS mapping
         ON mapping.id = observation.source_indicator_mapping_id
        AND mapping.source_id = observation.source_id
      WHERE mapping.indicator_id = $1::BIGINT
        AND observation.normalization_status = 'normalized'
        AND observation.value_normalized IS NOT NULL`,
    [id],
  );

  const offset = pagination.offset;
  const result = await pool.query(
    `SELECT
        observation.id,
        observation.value_raw,
        observation.unit_raw,
        observation.value_normalized,
        observation.unit_normalized,
        observation.period_start::TEXT AS period_start,
        observation.period_end::TEXT AS period_end,
        observation.dimensions,
        observation.source_updated_at,
        observation.collected_at,
        observation.source_document_id,
        observation.page_start,
        observation.page_end,
        observation.table_reference,
        observation.section_reference,
        mapping.external_code,
        source.id AS source_id,
        source.code AS source_code,
        source.name AS source_name,
        source.homepage_url AS source_homepage_url,
        geography.code_system AS geography_code_system,
        geography.code AS geography_code,
        geography.name AS geography_name,
        geography.level AS geography_level,
        document.title AS document_title,
        document.original_url AS document_original_url
       FROM indicator_observations AS observation
       JOIN source_indicator_mappings AS mapping
         ON mapping.id = observation.source_indicator_mapping_id
        AND mapping.source_id = observation.source_id
       JOIN sources AS source ON source.id = observation.source_id
       JOIN geographies AS geography ON geography.id = observation.geography_id
       LEFT JOIN source_documents AS document
         ON document.id = observation.source_document_id
        AND document.source_id = observation.source_id
      WHERE mapping.indicator_id = $1::BIGINT
        AND observation.normalization_status = 'normalized'
        AND observation.value_normalized IS NOT NULL
      ORDER BY observation.period_end DESC, observation.id DESC
      LIMIT $2
      OFFSET $3`,
    [id, pagination.limit, offset],
  );

  return {
    indicator: indicatorResult.rows[0],
    observations: result.rows,
    totalObservations: Number(countResult.rows[0].total),
  };
}

module.exports = {
  listSources,
  listCategories,
  listArticles,
  getArticleById,
  listIndicators,
  getIndicatorById,
};
