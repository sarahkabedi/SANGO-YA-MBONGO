WITH expected_sources(code, source_type, adapter_key) AS (
    VALUES
        ('gdelt_doc', 'news_api', 'gdelt_doc'),
        ('payments_afrika', 'rss', 'payments_afrika_rss'),
        ('world_bank', 'statistics_api', 'world_bank_api'),
        ('arptc', 'institutional', 'arptc_manual')
),
expected_categories(slug) AS (
    VALUES
        ('mobile-money'),
        ('paiements-marchands'),
        ('interoperabilite'),
        ('securite-fraude'),
        ('reglementation'),
        ('acteurs-fintech'),
        ('innovations'),
        ('education-financiere')
),
checks(check_type, code, is_present, matches_expected, details) AS (
    SELECT
        'source',
        expected.code,
        source.id IS NOT NULL,
        source.id IS NOT NULL
            AND source.source_type = expected.source_type
            AND source.adapter_key = expected.adapter_key,
        jsonb_build_object(
            'source_type', source.source_type,
            'adapter_key', source.adapter_key,
            'is_enabled', source.is_enabled
        )
    FROM expected_sources AS expected
    LEFT JOIN sources AS source ON source.code = expected.code

    UNION ALL

    SELECT
        'category',
        expected.slug,
        category.id IS NOT NULL,
        category.id IS NOT NULL,
        jsonb_build_object(
            'name', category.name,
            'is_active', category.is_active
        )
    FROM expected_categories AS expected
    LEFT JOIN categories AS category ON category.slug = expected.slug

    UNION ALL

    SELECT
        'geography',
        'ISO-3166-1-alpha-3/COD',
        geography.id IS NOT NULL,
        geography.id IS NOT NULL
            AND geography.level = 'country'
            AND geography.parent_id IS NULL
            AND geography.parent_level IS NULL,
        jsonb_build_object(
            'name', geography.name,
            'level', geography.level,
            'parent_id', geography.parent_id,
            'is_active', geography.is_active
        )
    FROM (VALUES (1)) AS seed(dummy)
    LEFT JOIN geographies AS geography
      ON geography.code_system = 'ISO-3166-1-alpha-3'
     AND geography.code = 'COD'

    UNION ALL

    SELECT
        'indicator',
        'FX.OWN.TOTL.ZS',
        indicator.id IS NOT NULL,
        indicator.id IS NOT NULL
            AND indicator.frequency = 'irregular',
        jsonb_build_object(
            'name', indicator.name,
            'unit', indicator.unit,
            'frequency', indicator.frequency,
            'is_active', indicator.is_active
        )
    FROM (VALUES (1)) AS seed(dummy)
    LEFT JOIN indicators AS indicator
      ON indicator.code = 'FX.OWN.TOTL.ZS'

    UNION ALL

    SELECT
        'indicator_mapping',
        'world_bank/FX.OWN.TOTL.ZS',
        mapping.id IS NOT NULL,
        mapping.id IS NOT NULL
            AND indicator.code = 'FX.OWN.TOTL.ZS',
        jsonb_build_object(
            'source_code', source.code,
            'external_code', mapping.external_code,
            'indicator_code', indicator.code,
            'external_unit', mapping.external_unit
        )
    FROM (VALUES (1)) AS seed(dummy)
    LEFT JOIN sources AS source ON source.code = 'world_bank'
    LEFT JOIN source_indicator_mappings AS mapping
      ON mapping.source_id = source.id
     AND mapping.external_code = 'FX.OWN.TOTL.ZS'
    LEFT JOIN indicators AS indicator ON indicator.id = mapping.indicator_id
)
SELECT
    check_type,
    code,
    is_present,
    matches_expected,
    details
FROM checks
ORDER BY check_type, code;
