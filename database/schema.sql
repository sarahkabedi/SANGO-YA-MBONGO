-- Brouillon technique du schema PostgreSQL de SANGO YA MBONGO.
-- A auditer avant toute execution. Ce fichier ne contient aucune donnee initiale.
-- Version minimale visee : PostgreSQL 14 (NUMERIC prend en charge +/-Infinity).

-- 1. users
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ,
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
    CONSTRAINT users_email_trimmed_nonempty_check
        CHECK (length(email) > 0 AND email = btrim(email)),
    CONSTRAINT users_password_hash_nonempty_check
        CHECK (length(password_hash) > 0)
);

CREATE UNIQUE INDEX users_email_lower_unique
    ON users (lower(email));

-- 2. sources
CREATE TABLE sources (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    adapter_key TEXT NOT NULL,
    homepage_url TEXT,
    requires_observation_document BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sources_code_nonempty_check CHECK (length(btrim(code)) > 0),
    CONSTRAINT sources_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT sources_adapter_key_nonempty_check
        CHECK (length(btrim(adapter_key)) > 0),
    CONSTRAINT sources_type_check
        CHECK (source_type IN ('news_api', 'rss', 'statistics_api', 'institutional'))
);

-- 3. categories
CREATE TABLE categories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT categories_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT categories_slug_nonempty_check CHECK (length(btrim(slug)) > 0)
);

-- 4. indicators
CREATE TABLE indicators (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    unit TEXT NOT NULL,
    frequency TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT indicators_code_nonempty_check CHECK (length(btrim(code)) > 0),
    CONSTRAINT indicators_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT indicators_definition_nonempty_check
        CHECK (length(btrim(definition)) > 0),
    CONSTRAINT indicators_unit_nonempty_check CHECK (length(btrim(unit)) > 0),
    CONSTRAINT indicators_frequency_check
        CHECK (frequency IS NULL OR frequency IN
            ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'irregular'))
);

-- 5. geographies
CREATE TABLE geographies (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_system TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    level TEXT NOT NULL,
    parent_id BIGINT,
    parent_level TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT geographies_code_system_code_unique UNIQUE (code_system, code),
    CONSTRAINT geographies_id_level_unique UNIQUE (id, level),
    CONSTRAINT geographies_parent_country_fk
        FOREIGN KEY (parent_id, parent_level)
        REFERENCES geographies (id, level) ON DELETE RESTRICT,
    CONSTRAINT geographies_code_system_nonempty_check
        CHECK (length(btrim(code_system)) > 0),
    CONSTRAINT geographies_code_nonempty_check CHECK (length(btrim(code)) > 0),
    CONSTRAINT geographies_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT geographies_level_check CHECK (level IN ('country', 'province')),
    CONSTRAINT geographies_parent_level_check CHECK (
        (level = 'country' AND parent_id IS NULL AND parent_level IS NULL)
        OR (
            level = 'province'
            AND parent_id IS NOT NULL
            AND parent_level = 'country'
        )
    )
);

CREATE INDEX geographies_parent_id_idx ON geographies (parent_id);

-- 6. sessions
CREATE TABLE sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT sessions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT sessions_token_hash_length_check
        CHECK (octet_length(token_hash) = 32),
    CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT sessions_last_seen_check CHECK (last_seen_at >= created_at),
    CONSTRAINT sessions_revoked_check
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- 7. articles
CREATE TABLE articles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id BIGINT,
    title TEXT NOT NULL,
    summary TEXT,
    language VARCHAR(10),
    published_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    publication_status TEXT NOT NULL DEFAULT 'pending_review',
    classification_method TEXT NOT NULL DEFAULT 'unclassified',
    classified_by BIGINT,
    classification_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT articles_category_fk
        FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
    CONSTRAINT articles_classified_by_fk
        FOREIGN KEY (classified_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT articles_title_nonempty_check CHECK (length(btrim(title)) > 0),
    CONSTRAINT articles_status_check
        CHECK (publication_status IN ('pending_review', 'published', 'hidden')),
    CONSTRAINT articles_classification_method_check
        CHECK (classification_method IN
            ('source_mapping', 'keyword_rule', 'manual', 'unclassified')),
    CONSTRAINT articles_manual_classification_check CHECK (
        classification_method <> 'manual'
        OR (classified_by IS NOT NULL AND classification_updated_at IS NOT NULL)
    )
);

CREATE INDEX articles_status_published_at_idx
    ON articles (publication_status, published_at DESC);
CREATE INDEX articles_category_id_idx ON articles (category_id);

-- 8. source_documents
CREATE TABLE source_documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    original_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    document_code TEXT,
    document_date DATE,
    language VARCHAR(10),
    mime_type TEXT,
    page_count INTEGER,
    file_checksum CHAR(64),
    storage_uri TEXT,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_documents_source_fk
        FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT,
    CONSTRAINT source_documents_source_url_unique
        UNIQUE (source_id, normalized_url),
    CONSTRAINT source_documents_id_source_unique UNIQUE (id, source_id),
    CONSTRAINT source_documents_title_nonempty_check
        CHECK (length(btrim(title)) > 0),
    CONSTRAINT source_documents_original_url_nonempty_check
        CHECK (length(btrim(original_url)) > 0),
    CONSTRAINT source_documents_normalized_url_nonempty_check
        CHECK (length(btrim(normalized_url)) > 0),
    CONSTRAINT source_documents_page_count_check
        CHECK (page_count IS NULL OR page_count > 0),
    CONSTRAINT source_documents_checksum_check
        CHECK (file_checksum IS NULL OR file_checksum ~ '^[0-9a-f]{64}$')
);

CREATE INDEX source_documents_source_id_idx ON source_documents (source_id);

-- 9. source_indicator_mappings
CREATE TABLE source_indicator_mappings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    indicator_id BIGINT NOT NULL,
    external_code TEXT NOT NULL,
    external_name TEXT,
    external_unit TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_indicator_mappings_source_fk
        FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT,
    CONSTRAINT source_indicator_mappings_indicator_fk
        FOREIGN KEY (indicator_id) REFERENCES indicators (id) ON DELETE RESTRICT,
    CONSTRAINT source_indicator_mappings_external_code_unique
        UNIQUE (source_id, external_code),
    CONSTRAINT source_indicator_mappings_id_source_unique
        UNIQUE (id, source_id),
    CONSTRAINT source_indicator_mappings_external_code_nonempty_check
        CHECK (length(btrim(external_code)) > 0)
);

CREATE INDEX source_indicator_mappings_indicator_id_idx
    ON source_indicator_mappings (indicator_id);

-- 10. article_url_aliases
CREATE TABLE article_url_aliases (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NOT NULL,
    normalized_url TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT article_url_aliases_article_fk
        FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE RESTRICT,
    CONSTRAINT article_url_aliases_normalized_url_nonempty_check
        CHECK (length(btrim(normalized_url)) > 0)
);

CREATE INDEX article_url_aliases_article_id_idx
    ON article_url_aliases (article_id);

-- 11. article_sources
CREATE TABLE article_sources (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    article_url_alias_id BIGINT NOT NULL,
    original_url TEXT NOT NULL,
    external_id TEXT,
    external_category TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT article_sources_source_fk
        FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT,
    CONSTRAINT article_sources_alias_fk
        FOREIGN KEY (article_url_alias_id)
        REFERENCES article_url_aliases (id) ON DELETE RESTRICT,
    CONSTRAINT article_sources_source_alias_unique
        UNIQUE (source_id, article_url_alias_id),
    CONSTRAINT article_sources_original_url_nonempty_check
        CHECK (length(btrim(original_url)) > 0),
    CONSTRAINT article_sources_seen_dates_check
        CHECK (last_seen_at >= first_seen_at)
);

CREATE UNIQUE INDEX article_sources_external_id_unique
    ON article_sources (source_id, external_id)
    WHERE external_id IS NOT NULL;
CREATE INDEX article_sources_alias_id_idx
    ON article_sources (article_url_alias_id);

-- 12. favorites
CREATE TABLE favorites (
    user_id BIGINT NOT NULL,
    article_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT favorites_pk PRIMARY KEY (user_id, article_id),
    CONSTRAINT favorites_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT favorites_article_fk
        FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
);

CREATE INDEX favorites_article_id_idx ON favorites (article_id);

-- 13. source_category_mappings
CREATE TABLE source_category_mappings (
    source_id BIGINT NOT NULL,
    external_category TEXT NOT NULL,
    category_id BIGINT NOT NULL,
    CONSTRAINT source_category_mappings_pk
        PRIMARY KEY (source_id, external_category),
    CONSTRAINT source_category_mappings_source_fk
        FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT,
    CONSTRAINT source_category_mappings_category_fk
        FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
    CONSTRAINT source_category_mappings_external_category_nonempty_check
        CHECK (length(btrim(external_category)) > 0)
);

CREATE INDEX source_category_mappings_category_id_idx
    ON source_category_mappings (category_id);

-- 14. collection_logs
CREATE TABLE collection_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    items_seen INTEGER NOT NULL DEFAULT 0,
    items_inserted INTEGER NOT NULL DEFAULT 0,
    items_duplicate INTEGER NOT NULL DEFAULT 0,
    items_skipped INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_summary TEXT,
    request_parameters JSONB,
    CONSTRAINT collection_logs_source_fk
        FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT,
    CONSTRAINT collection_logs_status_check
        CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    CONSTRAINT collection_logs_counts_check CHECK (
        items_seen >= 0
        AND items_inserted >= 0
        AND items_duplicate >= 0
        AND items_skipped >= 0
    ),
    CONSTRAINT collection_logs_finish_check
        CHECK (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT collection_logs_request_parameters_object_check
        CHECK (request_parameters IS NULL OR jsonb_typeof(request_parameters) = 'object')
);

CREATE INDEX collection_logs_source_started_idx
    ON collection_logs (source_id, started_at DESC);
CREATE INDEX collection_logs_status_idx ON collection_logs (status);

-- 15. article_classification_logs
CREATE TABLE article_classification_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NOT NULL,
    admin_user_id BIGINT NOT NULL,
    old_category_id BIGINT,
    new_category_id BIGINT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT,
    CONSTRAINT article_classification_logs_article_fk
        FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE RESTRICT,
    CONSTRAINT article_classification_logs_admin_fk
        FOREIGN KEY (admin_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT article_classification_logs_old_category_fk
        FOREIGN KEY (old_category_id) REFERENCES categories (id) ON DELETE RESTRICT,
    CONSTRAINT article_classification_logs_new_category_fk
        FOREIGN KEY (new_category_id) REFERENCES categories (id) ON DELETE RESTRICT,
    CONSTRAINT article_classification_logs_change_check
        CHECK (old_category_id IS DISTINCT FROM new_category_id)
);

CREATE INDEX article_classification_logs_article_changed_idx
    ON article_classification_logs (article_id, changed_at DESC);

CREATE FUNCTION require_admin_for_article_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    checked_user_id BIGINT;
    checked_role TEXT;
BEGIN
    IF TG_TABLE_NAME = 'articles' THEN
        IF NEW.classification_method <> 'manual' THEN
            RETURN NEW;
        END IF;

        checked_user_id := NEW.classified_by;
    ELSE
        checked_user_id := NEW.admin_user_id;
    END IF;

    SELECT role
      INTO checked_role
      FROM users
     WHERE id = checked_user_id
       FOR SHARE;

    IF NOT FOUND OR checked_role <> 'admin' THEN
        RAISE EXCEPTION 'Administrative classification requires an admin user'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER articles_require_admin_classification_trigger
BEFORE INSERT OR UPDATE OF
    category_id,
    classification_method,
    classified_by,
    classification_updated_at
ON articles
FOR EACH ROW
EXECUTE FUNCTION require_admin_for_article_classification();

CREATE TRIGGER classification_logs_require_admin_trigger
BEFORE INSERT OR UPDATE OF admin_user_id
ON article_classification_logs
FOR EACH ROW
EXECUTE FUNCTION require_admin_for_article_classification();

-- 16. indicator_observations
CREATE TABLE indicator_observations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    source_indicator_mapping_id BIGINT NOT NULL,
    geography_id BIGINT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    value_raw NUMERIC NOT NULL,
    unit_raw TEXT,
    value_normalized NUMERIC,
    unit_normalized TEXT,
    normalization_rule_code TEXT,
    normalization_version TEXT,
    normalization_status TEXT NOT NULL,
    dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_record_key TEXT,
    source_document_id BIGINT,
    page_start INTEGER,
    page_end INTEGER,
    table_reference TEXT,
    section_reference TEXT,
    source_updated_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT indicator_observations_source_mapping_fk
        FOREIGN KEY (source_indicator_mapping_id, source_id)
        REFERENCES source_indicator_mappings (id, source_id)
        ON DELETE RESTRICT,
    CONSTRAINT indicator_observations_geography_fk
        FOREIGN KEY (geography_id) REFERENCES geographies (id) ON DELETE RESTRICT,
    CONSTRAINT indicator_observations_source_document_fk
        FOREIGN KEY (source_document_id, source_id)
        REFERENCES source_documents (id, source_id)
        ON DELETE RESTRICT,
    CONSTRAINT indicator_observations_logical_unique
        UNIQUE (
            source_indicator_mapping_id,
            geography_id,
            period_start,
            period_end,
            dimensions
        ),
    CONSTRAINT indicator_observations_period_check
        CHECK (period_end >= period_start),
    CONSTRAINT indicator_observations_values_not_nan_check
        CHECK (
            value_raw NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
            AND (
                value_normalized IS NULL
                OR value_normalized NOT IN
                    ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
            )
        ),
    CONSTRAINT indicator_observations_units_nonempty_check
        CHECK (
            (unit_raw IS NULL OR length(btrim(unit_raw)) > 0)
            AND (unit_normalized IS NULL OR length(btrim(unit_normalized)) > 0)
        ),
    CONSTRAINT indicator_observations_normalization_status_check
        CHECK (normalization_status IN ('normalized', 'pending', 'not_applicable', 'failed')),
    CONSTRAINT indicator_observations_normalization_state_check
        CHECK (
            (
                normalization_status = 'normalized'
                AND value_normalized IS NOT NULL
                AND unit_normalized IS NOT NULL
                AND length(btrim(unit_normalized)) > 0
                AND normalization_rule_code IS NOT NULL
                AND length(btrim(normalization_rule_code)) > 0
                AND normalization_version IS NOT NULL
                AND length(btrim(normalization_version)) > 0
            )
            OR (
                normalization_status IN ('pending', 'failed')
                AND (
                    normalization_rule_code IS NULL
                    OR length(btrim(normalization_rule_code)) > 0
                )
                AND (
                    normalization_version IS NULL
                    OR length(btrim(normalization_version)) > 0
                )
            )
            OR (
                normalization_status = 'not_applicable'
                AND unit_raw IS NOT NULL
                AND length(btrim(unit_raw)) > 0
                AND value_normalized IS NULL
                AND unit_normalized IS NULL
                AND normalization_rule_code IS NULL
                AND normalization_version IS NULL
            )
        ),
    CONSTRAINT indicator_observations_dimensions_object_check
        CHECK (jsonb_typeof(dimensions) = 'object'),
    CONSTRAINT indicator_observations_provenance_snapshot_object_check
        CHECK (jsonb_typeof(provenance_snapshot) = 'object'),
    CONSTRAINT indicator_observations_pages_positive_check
        CHECK (
            (page_start IS NULL OR page_start > 0)
            AND (page_end IS NULL OR page_end > 0)
            AND (page_start IS NULL OR page_end IS NULL OR page_end >= page_start)
        ),
    CONSTRAINT indicator_observations_table_requires_document_check
        CHECK (table_reference IS NULL OR source_document_id IS NOT NULL),
    CONSTRAINT indicator_observations_section_requires_document_check
        CHECK (section_reference IS NULL OR source_document_id IS NOT NULL)
);

CREATE UNIQUE INDEX indicator_observations_source_record_key_unique
    ON indicator_observations (source_id, source_record_key)
    WHERE source_record_key IS NOT NULL;
CREATE INDEX indicator_observations_source_period_idx
    ON indicator_observations (source_id, period_start, period_end);
CREATE INDEX indicator_observations_geography_period_idx
    ON indicator_observations (geography_id, period_start, period_end);

-- 17. indicator_observation_revisions
CREATE TABLE indicator_observation_revisions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id BIGINT NOT NULL,
    revision_number INTEGER NOT NULL,
    source_id BIGINT NOT NULL,
    source_indicator_mapping_id BIGINT NOT NULL,
    geography_id BIGINT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    value_raw NUMERIC NOT NULL,
    unit_raw TEXT,
    value_normalized NUMERIC,
    unit_normalized TEXT,
    normalization_rule_code TEXT,
    normalization_version TEXT,
    normalization_status TEXT NOT NULL,
    dimensions JSONB NOT NULL,
    provenance_snapshot JSONB NOT NULL,
    source_record_key TEXT,
    source_document_id BIGINT,
    page_start INTEGER,
    page_end INTEGER,
    table_reference TEXT,
    section_reference TEXT,
    source_updated_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_origin TEXT NOT NULL DEFAULT 'source_revision',
    changed_by_user_id BIGINT,
    reason TEXT NOT NULL,
    CONSTRAINT indicator_observation_revisions_observation_fk
        FOREIGN KEY (observation_id)
        REFERENCES indicator_observations (id) ON DELETE RESTRICT,
    CONSTRAINT indicator_observation_revisions_source_mapping_fk
        FOREIGN KEY (source_indicator_mapping_id, source_id)
        REFERENCES source_indicator_mappings (id, source_id)
        ON DELETE RESTRICT,
    CONSTRAINT indicator_observation_revisions_geography_fk
        FOREIGN KEY (geography_id) REFERENCES geographies (id) ON DELETE RESTRICT,
    CONSTRAINT indicator_observation_revisions_source_document_fk
        FOREIGN KEY (source_document_id, source_id)
        REFERENCES source_documents (id, source_id)
        ON DELETE RESTRICT,
    CONSTRAINT indicator_observation_revisions_changed_by_fk
        FOREIGN KEY (changed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT indicator_observation_revisions_number_unique
        UNIQUE (observation_id, revision_number),
    CONSTRAINT indicator_observation_revisions_number_check
        CHECK (revision_number > 0),
    CONSTRAINT indicator_observation_revisions_period_check
        CHECK (period_end >= period_start),
    CONSTRAINT indicator_observation_revisions_values_not_nan_check
        CHECK (
            value_raw NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
            AND (
                value_normalized IS NULL
                OR value_normalized NOT IN
                    ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
            )
        ),
    CONSTRAINT indicator_observation_revisions_units_nonempty_check
        CHECK (
            (unit_raw IS NULL OR length(btrim(unit_raw)) > 0)
            AND (unit_normalized IS NULL OR length(btrim(unit_normalized)) > 0)
        ),
    CONSTRAINT indicator_observation_revisions_normalization_status_check
        CHECK (normalization_status IN ('normalized', 'pending', 'not_applicable', 'failed')),
    CONSTRAINT indicator_observation_revisions_normalization_state_check
        CHECK (
            (
                normalization_status = 'normalized'
                AND value_normalized IS NOT NULL
                AND unit_normalized IS NOT NULL
                AND length(btrim(unit_normalized)) > 0
                AND normalization_rule_code IS NOT NULL
                AND length(btrim(normalization_rule_code)) > 0
                AND normalization_version IS NOT NULL
                AND length(btrim(normalization_version)) > 0
            )
            OR (
                normalization_status IN ('pending', 'failed')
                AND (
                    normalization_rule_code IS NULL
                    OR length(btrim(normalization_rule_code)) > 0
                )
                AND (
                    normalization_version IS NULL
                    OR length(btrim(normalization_version)) > 0
                )
            )
            OR (
                normalization_status = 'not_applicable'
                AND unit_raw IS NOT NULL
                AND length(btrim(unit_raw)) > 0
                AND value_normalized IS NULL
                AND unit_normalized IS NULL
                AND normalization_rule_code IS NULL
                AND normalization_version IS NULL
            )
        ),
    CONSTRAINT indicator_observation_revisions_dimensions_object_check
        CHECK (jsonb_typeof(dimensions) = 'object'),
    CONSTRAINT indicator_observation_revisions_provenance_snapshot_object_check
        CHECK (jsonb_typeof(provenance_snapshot) = 'object'),
    CONSTRAINT indicator_observation_revisions_origin_check
        CHECK (change_origin IN ('source_revision', 'manual_correction')),
    CONSTRAINT indicator_observation_revisions_reason_nonempty_check
        CHECK (length(btrim(reason)) > 0),
    CONSTRAINT indicator_observation_revisions_pages_positive_check
        CHECK (
            (page_start IS NULL OR page_start > 0)
            AND (page_end IS NULL OR page_end > 0)
            AND (page_start IS NULL OR page_end IS NULL OR page_end >= page_start)
        )
);

CREATE INDEX indicator_observation_revisions_observation_recorded_idx
    ON indicator_observation_revisions (observation_id, recorded_at DESC);

-- Enforce that sources configured to require a document cannot have observations
-- without one. The composite FK above separately ensures the document belongs
-- to the same source as the observation. Lock the source row before checking
-- its policy so this path serializes with changes to that policy.
CREATE FUNCTION enforce_observation_source_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    document_required BOOLEAN;
BEGIN
    SELECT requires_observation_document
      INTO document_required
      FROM sources
     WHERE id = NEW.source_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source % does not exist', NEW.source_id
            USING ERRCODE = '23503';
    END IF;

    IF document_required AND NEW.source_document_id IS NULL THEN
        RAISE EXCEPTION
            'Source % requires a source document for every observation',
            NEW.source_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER indicator_observations_require_document_trigger
BEFORE INSERT OR UPDATE OF source_id, source_document_id
ON indicator_observations
FOR EACH ROW
EXECUTE FUNCTION enforce_observation_source_document();

-- Archive the complete previous state before a meaningful update. This trigger
-- and the row update execute in the same PostgreSQL transaction.
CREATE FUNCTION archive_indicator_observation_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    next_revision_number INTEGER;
    origin_setting TEXT;
    user_setting TEXT;
    reason_setting TEXT;
    revision_reason TEXT;
    revision_user_id BIGINT;
BEGIN
    IF ROW(
        OLD.source_id,
        OLD.source_indicator_mapping_id,
        OLD.geography_id,
        OLD.period_start,
        OLD.period_end,
        OLD.value_raw,
        OLD.unit_raw,
        OLD.value_normalized,
        OLD.unit_normalized,
        OLD.normalization_rule_code,
        OLD.normalization_version,
        OLD.normalization_status,
        OLD.dimensions,
        OLD.provenance_snapshot,
        OLD.source_record_key,
        OLD.source_document_id,
        OLD.page_start,
        OLD.page_end,
        OLD.table_reference,
        OLD.section_reference,
        OLD.source_updated_at
    ) IS DISTINCT FROM ROW(
        NEW.source_id,
        NEW.source_indicator_mapping_id,
        NEW.geography_id,
        NEW.period_start,
        NEW.period_end,
        NEW.value_raw,
        NEW.unit_raw,
        NEW.value_normalized,
        NEW.unit_normalized,
        NEW.normalization_rule_code,
        NEW.normalization_version,
        NEW.normalization_status,
        NEW.dimensions,
        NEW.provenance_snapshot,
        NEW.source_record_key,
        NEW.source_document_id,
        NEW.page_start,
        NEW.page_end,
        NEW.table_reference,
        NEW.section_reference,
        NEW.source_updated_at
    ) THEN
        SELECT COALESCE(MAX(revision_number), 0) + 1
          INTO next_revision_number
          FROM indicator_observation_revisions
         WHERE observation_id = OLD.id;

        origin_setting := current_setting('app.observation_change_origin', true);
        IF origin_setting IS NULL OR origin_setting = '' THEN
            origin_setting := 'source_revision';
        END IF;
        IF origin_setting NOT IN ('source_revision', 'manual_correction') THEN
            RAISE EXCEPTION 'Invalid observation change origin: %', origin_setting
                USING ERRCODE = '22023';
        END IF;

        user_setting := current_setting('app.observation_changed_by_user_id', true);
        IF user_setting IS NOT NULL AND user_setting <> '' THEN
            revision_user_id := user_setting::BIGINT;
        END IF;

        reason_setting := current_setting('app.observation_change_reason', true);
        IF origin_setting = 'manual_correction' THEN
            IF revision_user_id IS NULL THEN
                RAISE EXCEPTION
                    'Manual observation corrections require an administrator user ID'
                    USING ERRCODE = '23514';
            END IF;
            IF reason_setting IS NULL OR length(btrim(reason_setting)) = 0 THEN
                RAISE EXCEPTION
                    'Manual observation corrections require a non-empty reason'
                    USING ERRCODE = '23514';
            END IF;
            revision_reason := btrim(reason_setting);
        ELSE
            revision_reason := COALESCE(
                NULLIF(btrim(reason_setting), ''),
                'Automatic collection changed observation data or provenance.'
            );
        END IF;

        INSERT INTO indicator_observation_revisions (
            observation_id,
            revision_number,
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
            collected_at,
            updated_at,
            change_origin,
            changed_by_user_id,
            reason
        ) VALUES (
            OLD.id,
            next_revision_number,
            OLD.source_id,
            OLD.source_indicator_mapping_id,
            OLD.geography_id,
            OLD.period_start,
            OLD.period_end,
            OLD.value_raw,
            OLD.unit_raw,
            OLD.value_normalized,
            OLD.unit_normalized,
            OLD.normalization_rule_code,
            OLD.normalization_version,
            OLD.normalization_status,
            OLD.dimensions,
            OLD.provenance_snapshot,
            OLD.source_record_key,
            OLD.source_document_id,
            OLD.page_start,
            OLD.page_end,
            OLD.table_reference,
            OLD.section_reference,
            OLD.source_updated_at,
            OLD.collected_at,
            OLD.updated_at,
            origin_setting,
            revision_user_id,
            revision_reason
        );
        NEW.updated_at := now();
    ELSE
        NEW.updated_at := OLD.updated_at;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER indicator_observations_archive_revision_trigger
BEFORE UPDATE
ON indicator_observations
FOR EACH ROW
EXECUTE FUNCTION archive_indicator_observation_revision();

-- When enabling the document requirement, reject a source that already has
-- observations without documents. This keeps the invariant valid over time.
CREATE FUNCTION enforce_existing_observation_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    locked_source_id BIGINT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- No committed observation can reference this new source yet.
        -- Observation inserts will enforce the policy after this row commits.
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.requires_observation_document
           AND NOT OLD.requires_observation_document THEN
            -- UPDATE already holds this row lock; explicitly use the same lock
            -- mode as the observation trigger before checking existing rows.
            SELECT id
              INTO locked_source_id
              FROM sources
             WHERE id = NEW.id
               FOR NO KEY UPDATE;

            IF EXISTS (
                SELECT 1
                  FROM indicator_observations
                 WHERE source_id = NEW.id
                   AND source_document_id IS NULL
            ) THEN
                RAISE EXCEPTION
                    'Source % cannot require documents while documentless observations exist',
                    NEW.id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unexpected trigger operation: %', TG_OP
            USING ERRCODE = '0A000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER sources_require_existing_documents_trigger
BEFORE INSERT OR UPDATE OF requires_observation_document
ON sources
FOR EACH ROW
EXECUTE FUNCTION enforce_existing_observation_documents();
