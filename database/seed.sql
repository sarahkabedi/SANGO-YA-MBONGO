SET client_encoding TO 'UTF8';

BEGIN;

INSERT INTO sources (
    code,
    name,
    source_type,
    adapter_key,
    homepage_url,
    requires_observation_document,
    is_enabled
) VALUES
    (
        'gdelt_doc',
        'GDELT DOC 2.0',
        'news_api',
        'gdelt_doc',
        'https://www.gdeltproject.org/',
        false,
        true
    ),
    (
        'payments_afrika',
        'Payments Afrika',
        'rss',
        'payments_afrika_rss',
        'https://paymentsafrika.com/',
        false,
        true
    ),
    (
        'world_bank',
        'Banque mondiale',
        'statistics_api',
        'world_bank_api',
        'https://api.worldbank.org/v2/',
        false,
        true
    ),
    (
        'arptc',
        'Autorité de Régulation de la Poste et des Télécommunications du Congo',
        'institutional',
        'arptc_manual',
        'https://arptc.gouv.cd/',
        true,
        true
    )
ON CONFLICT (code) DO NOTHING;

INSERT INTO categories (name, slug, description) VALUES
    ('Mobile money et portefeuilles numériques', 'mobile-money', 'Services de monnaie mobile et portefeuilles numériques.'),
    ('Paiements marchands', 'paiements-marchands', 'Paiements numériques auprès des commerçants et entreprises.'),
    ('Interopérabilité des paiements', 'interoperabilite', 'Interopérabilité entre réseaux, banques et systèmes de paiement.'),
    ('Sécurité numérique et fraude', 'securite-fraude', 'Sécurité, protection des usagers et lutte contre la fraude numérique.'),
    ('Réglementation et politiques financières', 'reglementation', 'Réglementation et politiques relatives aux paiements et services financiers.'),
    ('Banques, télécoms et fintechs', 'acteurs-fintech', 'Évolutions concernant les banques, opérateurs télécoms et fintechs.'),
    ('Innovations et tendances technologiques', 'innovations', 'Innovations technologiques liées aux paiements numériques.'),
    ('Communication digitale et éducation financière', 'education-financiere', 'Éducation financière et usages numériques.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO indicators (
    code,
    name,
    definition,
    unit,
    frequency,
    is_active
) VALUES (
    'FX.OWN.TOTL.ZS',
    'Détention d’un compte financier ou usage d’un service de monnaie mobile',
    'Part des personnes âgées de 15 ans et plus déclarant détenir un compte dans une institution financière ou avoir personnellement utilisé un service de monnaie mobile au cours des 12 derniers mois. Source : Global Findex, Banque mondiale.',
    '% de la population âgée de 15 ans et plus',
    'irregular',
    true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO geographies (
    code_system,
    code,
    name,
    level,
    parent_id,
    parent_level,
    is_active
) VALUES (
    'ISO-3166-1-alpha-3',
    'COD',
    'République démocratique du Congo',
    'country',
    NULL,
    NULL,
    true
)
ON CONFLICT (code_system, code) DO NOTHING;

INSERT INTO source_indicator_mappings (
    source_id,
    indicator_id,
    external_code,
    external_name,
    external_unit
)
SELECT
    s.id,
    i.id,
    'FX.OWN.TOTL.ZS',
    'Account ownership at a financial institution or with a mobile-money-service provider (% of population ages 15+)',
    '% de la population âgée de 15 ans et plus'
FROM sources AS s
CROSS JOIN indicators AS i
WHERE s.code = 'world_bank'
  AND i.code = 'FX.OWN.TOTL.ZS'
ON CONFLICT (source_id, external_code) DO NOTHING;

DO $seed_validation$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM sources AS source
          JOIN source_indicator_mappings AS mapping
            ON mapping.source_id = source.id
          JOIN indicators AS indicator
            ON indicator.id = mapping.indicator_id
         WHERE source.code = 'world_bank'
           AND mapping.external_code = 'FX.OWN.TOTL.ZS'
           AND indicator.code <> 'FX.OWN.TOTL.ZS'
    ) THEN
        RAISE EXCEPTION
            'Seed conflict: World Bank mapping FX.OWN.TOTL.ZS points to a different indicator';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM sources AS source
          JOIN source_indicator_mappings AS mapping
            ON mapping.source_id = source.id
          JOIN indicators AS indicator
            ON indicator.id = mapping.indicator_id
         WHERE source.code = 'world_bank'
           AND mapping.external_code = 'FX.OWN.TOTL.ZS'
           AND indicator.code = 'FX.OWN.TOTL.ZS'
    ) THEN
        RAISE EXCEPTION
            'Seed incomplete: expected World Bank mapping FX.OWN.TOTL.ZS was not created';
    END IF;
END;
$seed_validation$;

COMMIT;
