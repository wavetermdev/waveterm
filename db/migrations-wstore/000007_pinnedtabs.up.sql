UPDATE db_workspace
SET data = json_set(data, '$.pinnedtabids', json('[]'))
WHERE json_extract(data, '$.pinnedtabids') IS NULL;
