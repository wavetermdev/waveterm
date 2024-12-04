UPDATE db_workspace
SET data = json_remove(
                json_set(
                    data,
                    '$.tabids',
                    json_insert(
                        json_extract(data, '$.tabids'),
                        0,
                        json_each.value
                    )
                ),
                '$.pinnedtabids'
            )
WHERE json_extract(data, '$.pinnedtabids') IS NOT NULL;
