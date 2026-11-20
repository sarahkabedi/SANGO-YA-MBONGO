const RETRYABLE_DATABASE_CODES = new Set(["40001", "40P01", "08000", "08003", "08006"]);
const RETRY_DELAYS_MS = [100, 300];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getErrorCode(error) {
  const code = error?.code;
  if (typeof code !== "string") {
    return "COLLECTION_ERROR";
  }
  if (/^[0-9A-Z]{5}$/.test(code)) {
    return code;
  }
  const knownNetworkCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
  ]);
  return knownNetworkCodes.has(code) ? code : "COLLECTION_ERROR";
}

function getSafeErrorSummary(error) {
  const safeMessages = {
    "08000": "La connexion à la base de données a échoué.",
    "08003": "La connexion à la base de données n’est plus disponible.",
    "08006": "La connexion à la base de données a été interrompue.",
    "22001": "Une valeur dépasse la longueur autorisée par la base.",
    "22P02": "Une valeur n’a pas le format attendu par la base.",
    "23502": "Une donnée obligatoire manque pour cet article.",
    "23503": "Une référence nécessaire à cet article est absente ou invalide.",
    "23505": "Un conflit d’unicité a empêché l’enregistrement de cet article.",
    "23514": "Une règle de validation de la base a refusé cet article.",
    "40001": "La transaction a échoué après plusieurs tentatives contrôlées.",
    "40P01": "La transaction a rencontré un interblocage après plusieurs tentatives.",
    ECONNREFUSED: "La connexion à la base de données a été refusée.",
    ECONNRESET: "La connexion à la base de données a été interrompue.",
    EAI_AGAIN: "La résolution du serveur de base de données a temporairement échoué.",
    ENOTFOUND: "Le serveur de base de données est introuvable.",
    ETIMEDOUT: "La connexion à la base de données a expiré.",
  };
  return safeMessages[getErrorCode(error)]
    || "Erreur inattendue pendant l’enregistrement de l’article; détails techniques masqués.";
}

function getArticleErrorReference(article) {
  let sourceUrl = null;
  const candidateUrl = article.originalUrl || article.normalizedUrl;
  if (typeof candidateUrl === "string") {
    try {
      const url = new URL(candidateUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        sourceUrl = url.toString();
      }
    } catch {
      sourceUrl = null;
    }
  }

  const title = typeof article.title === "string" ? article.title.trim().slice(0, 300) : "";
  return {
    ...(title ? { title } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

async function retryDatabaseOperation(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!RETRYABLE_DATABASE_CODES.has(error.code) || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function resolveSource(pool, sourceCode) {
  const result = await pool.query(
    `SELECT id
       FROM sources
      WHERE code = $1
        AND is_enabled = TRUE`,
    [sourceCode],
  );
  if (result.rows.length === 0) {
    throw new Error(`La source « ${sourceCode} » est absente ou désactivée. Exécutez d’abord database/seed.sql.`);
  }
  return result.rows[0].id;
}

async function startCollectionLog(pool, sourceId, requestParameters) {
  const result = await pool.query(
    `INSERT INTO collection_logs (source_id, status, request_parameters)
     VALUES ($1, 'running', $2::JSONB)
     RETURNING id`,
    [sourceId, requestParameters],
  );
  return result.rows[0].id;
}

async function finishCollectionLog(pool, logId, summary, error = null) {
  const lastItemError = summary.errors?.at(-1);
  const hasItemErrors = summary.skipped > 0 || (summary.errors?.length || 0) > 0;
  const status = error
    ? (summary.inserted > 0 ? "partial" : "failed")
    : (hasItemErrors ? "partial" : "succeeded");
  await pool.query(
    `UPDATE collection_logs
        SET finished_at = now(),
            status = $2,
            items_seen = $3,
            items_inserted = $4,
            items_duplicate = $5,
            items_skipped = $6,
            error_code = $7,
            error_summary = $8
      WHERE id = $1`,
    [
      logId,
      status,
      summary.seen,
      summary.inserted,
      summary.duplicates,
      summary.skipped,
      error
        ? getErrorCode(error)
        : (lastItemError?.code || (hasItemErrors ? (summary.errorCode || "ITEMS_SKIPPED") : null)),
      error
        ? getSafeErrorSummary(error)
        : (lastItemError?.message || (hasItemErrors ? summary.errorSummary : null)),
    ],
  );
}

async function withTransaction(pool, operation) {
  return retryDatabaseOperation(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

async function persistArticleAttempt(pool, sourceId, article) {
  return withTransaction(pool, async (client) => {
    const lockKeys = [`url:${article.normalizedUrl}`];
    if (article.externalId) {
      lockKeys.push(`external:${sourceId}:${article.externalId}`);
    }
    lockKeys.sort();
    for (const lockKey of lockKeys) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [lockKey],
      );
    }

    if (article.externalId) {
      const priorExternalId = await client.query(
        `SELECT article_url_alias_id
           FROM article_sources
          WHERE source_id = $1
            AND external_id = $2
          FOR UPDATE`,
        [sourceId, article.externalId],
      );
      if (priorExternalId.rows.length > 0) {
        await client.query(
          `UPDATE article_sources
              SET last_seen_at = now(),
                  external_category = COALESCE($3, external_category)
            WHERE source_id = $1
              AND external_id = $2`,
          [sourceId, article.externalId, article.externalCategory],
        );
        return { inserted: false, duplicate: true };
      }
    }

    const existingAlias = await client.query(
      `SELECT id, article_id
         FROM article_url_aliases
        WHERE normalized_url = $1
        FOR UPDATE`,
      [article.normalizedUrl],
    );
    let alias;
    let inserted = false;
    if (existingAlias.rows.length > 0) {
      alias = existingAlias.rows[0];
    } else {
      const createdArticle = await client.query(
        `INSERT INTO articles (
            title,
            summary,
            language,
            published_at,
            publication_status,
            classification_method
         )
         VALUES ($1, $2, $3, $4::TIMESTAMPTZ, 'pending_review', 'unclassified')
         RETURNING id`,
        [article.title, article.summary, article.language, article.publishedAt],
      );
      const createdAlias = await client.query(
        `INSERT INTO article_url_aliases (article_id, normalized_url)
         VALUES ($1, $2)
         RETURNING id, article_id`,
        [createdArticle.rows[0].id, article.normalizedUrl],
      );
      alias = createdAlias.rows[0];
      inserted = true;
    }

    await client.query(
      `INSERT INTO article_sources (
          source_id,
          article_url_alias_id,
          original_url,
          external_id,
          external_category
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, article_url_alias_id) DO UPDATE SET
          last_seen_at = now(),
          external_category = COALESCE(EXCLUDED.external_category, article_sources.external_category)`,
      [
        sourceId,
        alias.id,
        article.originalUrl,
        article.externalId,
        article.externalCategory,
      ],
    );

    return { inserted, duplicate: !inserted, articleId: alias.article_id };
  });
}

async function persistArticle(pool, sourceId, article) {
  try {
    return await persistArticleAttempt(pool, sourceId, article);
  } catch (error) {
    if (error.code !== "23505") {
      throw error;
    }
    await wait(100);
    return persistArticleAttempt(pool, sourceId, article);
  }
}

async function runNewsCollection(options) {
  const { sourceCode, adapter, apply = false } = options;
  if (!apply) {
    const result = await adapter();
    return {
      mode: "dry-run",
      source: sourceCode,
      seen: result.seen,
      candidates: result.items.length,
      ignored: result.skipped,
      inserted: 0,
      duplicates: 0,
      failed: 0,
      errors: [],
      request: result.request,
      sample: result.items.slice(0, 5).map((article) => ({
        title: article.title,
        publishedAt: article.publishedAt,
        url: article.normalizedUrl,
      })),
    };
  }

  if (!options.pool) {
    throw new Error("Un pool PostgreSQL est requis pour le mode --apply.");
  }
  const sourceId = await resolveSource(options.pool, sourceCode);
  const requestParameters = options.requestParameters || { adapter: sourceCode };
  const logId = await startCollectionLog(options.pool, sourceId, requestParameters);
  const summary = {
    seen: 0,
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
    errorCode: null,
    errorSummary: null,
  };
  let fatalError = null;

  try {
    const result = await adapter();
    summary.seen = result.seen;
    summary.skipped = result.skipped;
    for (const article of result.items) {
      try {
        const persisted = await persistArticle(options.pool, sourceId, article);
        if (persisted.inserted) summary.inserted += 1;
        if (persisted.duplicate) summary.duplicates += 1;
      } catch (error) {
        if (error.code === "23505") {
          summary.duplicates += 1;
          continue;
        }
        const code = getErrorCode(error);
        const message = getSafeErrorSummary(error);
        summary.errors.push({
          ...getArticleErrorReference(article),
          code,
          message,
        });
        summary.errorCode = code;
        summary.errorSummary = message;
      }
    }
  } catch (error) {
    fatalError = error;
  }

  try {
    await finishCollectionLog(options.pool, logId, summary, fatalError);
  } catch (logError) {
    if (!fatalError) {
      throw logError;
    }
    fatalError.collectionLogError = getSafeErrorSummary(logError);
  }
  if (fatalError) throw fatalError;

  const { skipped, errors, ...counts } = summary;
  return {
    mode: "apply",
    source: sourceCode,
    ...counts,
    ignored: skipped,
    failed: errors.length,
    errors,
  };
}

async function resolveIndicatorTarget(pool, sourceCode, indicatorCode) {
  const result = await pool.query(
    `SELECT source.id AS source_id,
            mapping.id AS mapping_id,
            geography.id AS geography_id,
            mapping.external_unit
       FROM sources AS source
       JOIN source_indicator_mappings AS mapping
         ON mapping.source_id = source.id
       JOIN indicators AS indicator
         ON indicator.id = mapping.indicator_id
       JOIN geographies AS geography
         ON geography.code_system = 'ISO-3166-1-alpha-3'
        AND geography.code = 'COD'
        AND geography.level = 'country'
      WHERE source.code = $1
        AND source.is_enabled = TRUE
        AND indicator.code = $2
      LIMIT 1`,
    [sourceCode, indicatorCode],
  );
  if (result.rows.length === 0) {
    throw new Error(
      `Mapping, indicateur ou géographie COD manquant pour ${sourceCode}/${indicatorCode}. Exécutez database/seed.sql.`,
    );
  }
  return result.rows[0];
}

async function persistObservationInTransaction(client, target, item) {
    const inserted = await client.query(
      `INSERT INTO indicator_observations (
          source_id,
          source_indicator_mapping_id,
          geography_id,
          period_start,
          period_end,
          value_raw,
          unit_raw,
          value_normalized,
          unit_normalized,
          normalization_rule_code,
          normalization_version,
          normalization_status,
          dimensions,
          provenance_snapshot,
          source_record_key,
          source_document_id,
          page_start,
          page_end,
          table_reference,
          section_reference,
          source_updated_at,
          collected_at
       )
       VALUES (
          $1, $2, $3, $4::DATE, $5::DATE, $6::NUMERIC, $7,
          $8::NUMERIC, $9, $10, $11, $12, $13::JSONB, $14::JSONB,
          $15, $16, $17, $18, $19, $20, $21::TIMESTAMPTZ, now()
       )
       ON CONFLICT ON CONSTRAINT indicator_observations_logical_unique
       DO NOTHING
       RETURNING id`,
      [
        target.source_id,
        target.mapping_id,
        target.geography_id,
        item.periodStart,
        item.periodEnd,
        item.valueRaw,
        item.unitRaw,
        item.valueNormalized,
        item.unitNormalized,
        item.normalizationRuleCode,
        item.normalizationVersion,
        item.normalizationStatus,
        item.dimensions,
        item.provenanceSnapshot,
        item.sourceRecordKey,
        item.sourceDocumentId || null,
        item.pageStart || null,
        item.pageEnd || null,
        item.tableReference || null,
        item.sectionReference || null,
        item.sourceUpdatedAt ?? null,
      ],
    );
    if (inserted.rows.length > 0) {
      return { inserted: true, updated: false };
    }

    const updated = await client.query(
      `UPDATE indicator_observations
          SET value_raw = $6::NUMERIC,
              unit_raw = $7,
              value_normalized = $8::NUMERIC,
              unit_normalized = $9,
              normalization_rule_code = $10,
              normalization_version = $11,
              normalization_status = $12,
              provenance_snapshot = $13::JSONB,
              source_record_key = $14,
              source_document_id = $15,
              page_start = $16,
              page_end = $17,
              table_reference = $18,
              section_reference = $19,
              source_updated_at = $20::TIMESTAMPTZ,
              collected_at = now()
        WHERE source_indicator_mapping_id = $2
          AND source_id = $1
          AND geography_id = $3
          AND period_start = $4::DATE
          AND period_end = $5::DATE
          AND dimensions = $21::JSONB
        RETURNING id`,
      [
        target.source_id,
        target.mapping_id,
        target.geography_id,
        item.periodStart,
        item.periodEnd,
        item.valueRaw,
        item.unitRaw,
        item.valueNormalized,
        item.unitNormalized,
        item.normalizationRuleCode,
        item.normalizationVersion,
        item.normalizationStatus,
        item.provenanceSnapshot,
        item.sourceRecordKey,
        item.sourceDocumentId || null,
        item.pageStart || null,
        item.pageEnd || null,
        item.tableReference || null,
        item.sectionReference || null,
        item.sourceUpdatedAt ?? null,
        item.dimensions,
      ],
    );
    if (updated.rows.length === 0) {
      throw new Error("Une observation ayant la même clé de source existe déjà.");
    }
    return { inserted: false, updated: true };
}

async function persistObservation(pool, target, item) {
  return withTransaction(pool, (client) => persistObservationInTransaction(client, target, item));
}

async function runIndicatorCollection(options) {
  const { sourceCode, adapter, apply = false } = options;
  if (!apply) {
    const result = await adapter();
    return {
      mode: "dry-run",
      source: sourceCode,
      seen: result.seen,
      candidates: result.items.length,
      skipped: result.skipped,
      inserted: 0,
      duplicates: 0,
      indicators: result.indicators?.map((entry) => ({
        code: entry.indicator.code,
        seen: entry.seen,
        candidates: entry.items.length,
      })),
    };
  }

  if (!options.pool) {
    throw new Error("Un pool PostgreSQL est requis pour le mode --apply.");
  }
  const sourceId = await resolveSource(options.pool, sourceCode);
  const requestParameters = options.requestParameters || { adapter: sourceCode };
  const logId = await startCollectionLog(options.pool, sourceId, requestParameters);
  const summary = {
    seen: 0,
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    errorCode: null,
    errorSummary: null,
  };
  let fatalError = null;

  try {
    const result = await adapter();
    summary.seen = result.seen;
    summary.skipped = result.skipped;
    for (const indicatorResult of result.indicators) {
      const target = await resolveIndicatorTarget(
        options.pool,
        sourceCode,
        indicatorResult.indicator.code,
      );
      if (typeof target.external_unit !== "string" || !target.external_unit.trim()) {
        throw new Error(
          `L’unité source du mapping ${indicatorResult.indicator.code} doit être configurée avant l’import.`,
        );
      }
      for (const item of indicatorResult.items) {
        try {
          const persisted = await persistObservation(options.pool, target, {
            ...item,
            unitRaw: target.external_unit,
            unitNormalized: target.external_unit,
            provenanceSnapshot: {
              ...item.provenanceSnapshot,
              unitSource: "source_indicator_mappings.external_unit",
              normalization: "identity: no value or unit conversion",
            },
          });
          if (persisted.inserted) summary.inserted += 1;
          else summary.duplicates += 1;
        } catch (error) {
          summary.skipped += 1;
          summary.errorCode = getErrorCode(error);
          summary.errorSummary = getSafeErrorSummary(error);
        }
      }
    }
  } catch (error) {
    fatalError = error;
  }

  try {
    await finishCollectionLog(options.pool, logId, summary, fatalError);
  } catch (logError) {
    if (!fatalError) {
      throw logError;
    }
    fatalError.collectionLogError = getSafeErrorSummary(logError);
  }
  if (fatalError) throw fatalError;
  return { mode: "apply", source: sourceCode, ...summary };
}

module.exports = {
  runNewsCollection,
  runIndicatorCollection,
  getErrorCode,
  getSafeErrorSummary,
  persistArticle,
  persistObservation,
  persistObservationInTransaction,
  resolveIndicatorTarget,
  withTransaction,
  retryDatabaseOperation,
};
