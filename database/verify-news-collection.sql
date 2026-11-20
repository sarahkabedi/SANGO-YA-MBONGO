-- Read-only counts of imported articles by source and publication status.
WITH expected_statuses (publication_status) AS (
    VALUES
        ('pending_review'::TEXT),
        ('published'::TEXT),
        ('hidden'::TEXT)
)
SELECT
    source.code AS source_code,
    source.name AS source_name,
    source.is_enabled,
    expected_statuses.publication_status,
    COUNT(DISTINCT article.id) AS articles_count
FROM sources AS source
CROSS JOIN expected_statuses
LEFT JOIN article_sources AS article_source
    ON article_source.source_id = source.id
LEFT JOIN article_url_aliases AS alias
    ON alias.id = article_source.article_url_alias_id
LEFT JOIN articles AS article
    ON article.id = alias.article_id
   AND article.publication_status = expected_statuses.publication_status
GROUP BY
    source.id,
    source.code,
    source.name,
    source.is_enabled,
    expected_statuses.publication_status
ORDER BY source.code, expected_statuses.publication_status;
