-- Merge PinnedTabIds into TabIds, preserving tab order
UPDATE db_workspace
SET data = json_set(
  data,
  '$.tabids',
  (
    SELECT json_group_array(value)
    FROM (
      SELECT value, 0 AS src, CAST(key AS INT) AS k
      FROM json_each(data, '$.pinnedtabids')
      UNION ALL
      SELECT value, 1 AS src, CAST(key AS INT) AS k
      FROM json_each(data, '$.tabids')
      ORDER BY src, k
    )
  )
)
WHERE json_type(data, '$.pinnedtabids') = 'array'
  AND json_array_length(data, '$.pinnedtabids') > 0;

UPDATE db_workspace
SET data = json_remove(data, '$.pinnedtabids')
WHERE json_type(data, '$.pinnedtabids') IS NOT NULL;
