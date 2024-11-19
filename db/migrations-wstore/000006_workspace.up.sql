UPDATE db_workspace
SET data = json_set(db_workspace.data, '$.activetabid', (SELECT 1 FROM json_extract(db_window.data, '$.activetabid')))
FROM db_window
WHERE db_workspace.oid IN (SELECT 1 FROM json_extract(db_window.data, '$.workspaceid'));
