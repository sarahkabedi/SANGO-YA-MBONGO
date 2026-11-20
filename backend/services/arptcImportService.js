const { normalizeUrl } = require("../collectors/articleNormalizer");
const {
  finishCollectionLog,
  resolveSource,
  startCollectionLog,
  persistObservationInTransaction,
  withTransaction,
} = require("./collectionService");

const NUMERIC_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateNumeric(value, field) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || text.length > 1000 || !NUMERIC_PATTERN.test(text)) {
    throw new Error(`Le champ « ${field} » doit être une valeur numérique finie.`);
  }
  return text;
}

function validateManualReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Le document d’import doit être un objet JSON.");
  }
  const document = report.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Le champ « document » est obligatoire.");
  }
  if (typeof document.title !== "string" || !document.title.trim()) {
    throw new Error("Le titre du rapport institutionnel est obligatoire.");
  }
  const normalizedUrl = normalizeUrl(document.originalUrl);
  if (!normalizedUrl) {
    throw new Error("Le rapport doit contenir une URL originale HTTP ou HTTPS valide.");
  }
  if (document.documentDate !== undefined && document.documentDate !== null && !isValidDate(document.documentDate)) {
    throw new Error("La date du document doit être une date réelle au format AAAA-MM-JJ.");
  }
  if (document.pageCount !== undefined && document.pageCount !== null) {
    if (!Number.isInteger(document.pageCount) || document.pageCount < 1) {
      throw new Error("Le nombre de pages doit être un entier strictement positif.");
    }
  }
  if (document.fileChecksum !== undefined && document.fileChecksum !== null) {
    if (!/^[0-9a-f]{64}$/.test(document.fileChecksum)) {
      throw new Error("L’empreinte du document doit être un SHA-256 hexadécimal en minuscules.");
    }
  }
  if (!Array.isArray(report.observations)) {
    throw new Error("Le champ « observations » doit être un tableau.");
  }

  const observations = report.observations.map((observation, index) => {
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new Error(`L’observation ${index + 1} doit être un objet.`);
    }
    if (!/^[A-Z0-9._-]{1,100}$/.test(observation.indicatorCode || "")) {
      throw new Error(`L’observation ${index + 1} doit référencer un code d’indicateur valide.`);
    }
    if (!/^[^\s]{1,200}$/.test(observation.externalCode || "")) {
      throw new Error(`L’observation ${index + 1} doit fournir un code externe valide.`);
    }
    if (!/^[A-Z0-9._-]{1,100}$/.test(observation.geographyCodeSystem || "")) {
      throw new Error(`Le système géographique de l’observation ${index + 1} est invalide.`);
    }
    if (!/^[A-Z0-9._-]{1,100}$/.test(observation.geographyCode || "")) {
      throw new Error(`Le code géographique de l’observation ${index + 1} est invalide.`);
    }
    if (!isValidDate(observation.periodStart) || !isValidDate(observation.periodEnd) || observation.periodEnd < observation.periodStart) {
      throw new Error(`La période de l’observation ${index + 1} est invalide.`);
    }
    const raw = validateNumeric(observation.valueRaw, `observations[${index}].valueRaw`);
    const normalizedFields = [
      observation.valueNormalized,
      observation.unitNormalized,
      observation.normalizationRuleCode,
      observation.normalizationVersion,
    ];
    const hasAnyNormalizedValue = normalizedFields.some((value) => value !== undefined && value !== null);
    if (hasAnyNormalizedValue && normalizedFields.some((value) => value === undefined || value === null || value === "")) {
      throw new Error(`L’observation ${index + 1} doit fournir toutes les métadonnées de normalisation, ou aucune.`);
    }
    const normalized = hasAnyNormalizedValue
      ? validateNumeric(observation.valueNormalized, `observations[${index}].valueNormalized`)
      : null;
    for (const field of ["unitRaw", "unitNormalized", "normalizationRuleCode", "normalizationVersion"]) {
      const fieldValue = observation[field];
      if (fieldValue !== undefined && fieldValue !== null && (
        typeof fieldValue !== "string" || !fieldValue.trim()
      )) {
        throw new Error(`Le champ « observations[${index}].${field} » doit être une chaîne non vide ou NULL.`);
      }
    }
    for (const field of ["pageStart", "pageEnd"]) {
      const fieldValue = observation[field];
      if (fieldValue !== undefined && fieldValue !== null && (
        !Number.isInteger(fieldValue) || fieldValue < 1
      )) {
        throw new Error(`Le champ « observations[${index}].${field} » doit être un entier positif.`);
      }
    }
    if (
      observation.pageStart &&
      observation.pageEnd &&
      observation.pageEnd < observation.pageStart
    ) {
      throw new Error(`Les références de page de l’observation ${index + 1} sont incohérentes.`);
    }
    if (observation.dimensions !== undefined && (
      !observation.dimensions ||
      typeof observation.dimensions !== "object" ||
      Array.isArray(observation.dimensions)
    )) {
      throw new Error(`Les dimensions de l’observation ${index + 1} doivent être un objet JSON.`);
    }
    return {
      ...observation,
      valueRaw: raw,
      valueNormalized: normalized,
      unitRaw: observation.unitRaw?.trim() || null,
      unitNormalized: observation.unitNormalized?.trim() || null,
      normalizationRuleCode: observation.normalizationRuleCode?.trim() || null,
      normalizationVersion: observation.normalizationVersion?.trim() || null,
      normalizationStatus: hasAnyNormalizedValue ? "normalized" : "pending",
      dimensions: observation.dimensions || {},
    };
  });

  return {
    document: {
      ...document,
      title: document.title.trim(),
      originalUrl: document.originalUrl.trim(),
      normalizedUrl,
    },
    observations,
  };
}

async function findOrCreateSourceMapping(client, sourceId, observation) {
  const indicatorResult = await client.query(
    `SELECT id
       FROM indicators
      WHERE code = $1
        AND is_active = TRUE`,
    [observation.indicatorCode],
  );
  if (indicatorResult.rows.length === 0) {
    throw new Error(`Indicateur « ${observation.indicatorCode} » absent ou inactif.`);
  }
  const indicatorId = indicatorResult.rows[0].id;

  let mappingResult = await client.query(
    `SELECT id, indicator_id
       FROM source_indicator_mappings
      WHERE source_id = $1
        AND external_code = $2
      FOR UPDATE`,
    [sourceId, observation.externalCode],
  );
  if (mappingResult.rows.length === 0) {
    await client.query(
      `INSERT INTO source_indicator_mappings (
          source_id,
          indicator_id,
          external_code,
          external_name,
          external_unit
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, external_code) DO NOTHING`,
      [
        sourceId,
        indicatorId,
        observation.externalCode,
        observation.indicatorName || observation.indicatorCode,
        observation.unitRaw,
      ],
    );
    mappingResult = await client.query(
      `SELECT id, indicator_id
         FROM source_indicator_mappings
        WHERE source_id = $1
          AND external_code = $2
        FOR UPDATE`,
      [sourceId, observation.externalCode],
    );
  }
  if (String(mappingResult.rows[0].indicator_id) !== String(indicatorId)) {
    throw new Error(`Le mapping « ${observation.externalCode} » est déjà associé à un autre indicateur.`);
  }
  return mappingResult.rows[0].id;
}

async function resolveGeography(client, observation) {
  const result = await client.query(
    `SELECT id
       FROM geographies
      WHERE code_system = $1
        AND code = $2
        AND is_active = TRUE`,
    [observation.geographyCodeSystem, observation.geographyCode],
  );
  if (result.rows.length === 0) {
    throw new Error(
      `Géographie introuvable : ${observation.geographyCodeSystem}/${observation.geographyCode}.`,
    );
  }
  return result.rows[0].id;
}

async function persistManualReport(pool, validatedReport) {
  const sourceId = await resolveSource(pool, "arptc");
  const logId = await startCollectionLog(pool, sourceId, {
    adapter: "arptc_manual",
    documentUrl: validatedReport.document.normalizedUrl,
  });
  const summary = {
    seen: validatedReport.observations.length,
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    errorSummary: null,
  };

  let transactionResult;
  try {
    transactionResult = await withTransaction(pool, async (client) => {
      const document = validatedReport.document;
      const insertedDocument = await client.query(
        `INSERT INTO source_documents (
            source_id,
            title,
            original_url,
            normalized_url,
            document_code,
            document_date,
            language,
            mime_type,
            page_count,
            file_checksum,
            storage_uri
         )
         VALUES ($1, $2, $3, $4, $5, $6::DATE, $7, $8, $9, $10, $11)
         ON CONFLICT (source_id, normalized_url) DO NOTHING
         RETURNING id`,
        [
          sourceId,
          document.title,
          document.originalUrl,
          document.normalizedUrl,
          document.documentCode || null,
          document.documentDate || null,
          document.language || null,
          document.mimeType || null,
          document.pageCount || null,
          document.fileChecksum || null,
          document.storageUri || null,
        ],
      );
      let documentId = insertedDocument.rows[0]?.id;
      if (!documentId) {
        const existingDocument = await client.query(
          `SELECT id
             FROM source_documents
            WHERE source_id = $1
              AND normalized_url = $2
            FOR UPDATE`,
          [sourceId, document.normalizedUrl],
        );
        documentId = existingDocument.rows[0]?.id;
      }
      if (!documentId) {
        throw new Error("Le document source n’a pas pu être enregistré ou retrouvé.");
      }

      const transactionSummary = { inserted: 0, duplicates: 0 };
      for (const observation of validatedReport.observations) {
        const mappingId = await findOrCreateSourceMapping(client, sourceId, observation);
        const geographyId = await resolveGeography(client, observation);
        const persisted = await persistObservationInTransaction(client, {
          source_id: sourceId,
          mapping_id: mappingId,
          geography_id: geographyId,
        }, {
          ...observation,
          sourceDocumentId: documentId,
          provenanceSnapshot: {
            documentTitle: document.title,
            documentCode: document.documentCode || null,
            documentDate: document.documentDate || null,
            originalUrl: document.originalUrl,
            normalizedUrl: document.normalizedUrl,
            pageStart: observation.pageStart || null,
            pageEnd: observation.pageEnd || null,
            tableReference: observation.tableReference || null,
            sectionReference: observation.sectionReference || null,
            reportedBy: "manual_arptc_import",
          },
          sourceUpdatedAt: null,
        });
        if (persisted.inserted) transactionSummary.inserted += 1;
        else transactionSummary.duplicates += 1;
      }

      return { documentId, ...transactionSummary };
    });
  } catch (error) {
    summary.skipped = summary.seen;
    try {
      await finishCollectionLog(pool, logId, summary, error);
    } catch (logError) {
      error.collectionLogError = logError.message;
    }
    throw error;
  }

  summary.inserted = transactionResult.inserted;
  summary.duplicates = transactionResult.duplicates;
  await finishCollectionLog(pool, logId, summary);
  return {
    mode: "apply",
    source: "arptc",
    documentId: String(transactionResult.documentId),
    ...summary,
  };
}

function summarizeManualReport(validatedReport) {
  return {
    mode: "dry-run",
    source: "arptc",
    document: {
      title: validatedReport.document.title,
      normalizedUrl: validatedReport.document.normalizedUrl,
    },
    observations: validatedReport.observations.length,
    inserted: 0,
  };
}

module.exports = {
  validateManualReport,
  persistManualReport,
  summarizeManualReport,
};
