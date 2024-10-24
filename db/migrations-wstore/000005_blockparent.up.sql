UPDATE db_block
SET data = json_set(db_block.data, '$.parentoref', 'tab:' || db_tab.oid)
FROM db_tab
WHERE db_block.oid IN (SELECT value FROM json_each(db_tab.data, '$.blockids'));
