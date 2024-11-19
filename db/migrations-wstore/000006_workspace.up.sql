UPDATE db_workspace
SET data = json_set(db_workspace.data, '$.activetabid', json_each(db_window.data, '$.activetabid'))
FROM db_window
WHERE db_workspace.oid IN (SELECT value FROM json_each(db_window.data, '$.workspaceid'));
