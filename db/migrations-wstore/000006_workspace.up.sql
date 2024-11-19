UPDATE db_workspace
SELECT value FROM json_each(db_window.data, '$.activetabid') as activetabid
SET data = json_set(db_workspace.data, '$.activetabid', activetabid)
FROM db_window
WHERE db_workspace.oid IN (SELECT value FROM json_each(db_window.data, '$.workspaceid'));
