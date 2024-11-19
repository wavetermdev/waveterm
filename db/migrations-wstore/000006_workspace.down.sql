UPDATE db_window
SET data = json_set(db_window.data, '$.activetabid', json_get(db_workspace.data, '$.activetabid'))
FROM db_workspace
WHERE db_workspace.oid IN (SELECT value FROM json_each(db_window.data, '$.workspaceid'));
