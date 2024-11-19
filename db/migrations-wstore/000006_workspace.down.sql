-- Step 1: Restore the $.activetabid field to db_window.data
UPDATE db_window
SET data = json_set(
    db_window.data,
    '$.activetabid',
    (SELECT json_extract(db_workspace.data, '$.activetabid')
     FROM db_workspace
     WHERE db_workspace.oid = json_extract(db_window.data, '$.workspaceid'))
)
WHERE json_extract(data, '$.workspaceid') IN (
    SELECT oid FROM db_workspace
);

-- Step 2: Remove the $.activetabid field from db_workspace.data
UPDATE db_workspace
SET data = json_remove(data, '$.activetabid')
WHERE oid IN (
    SELECT json_extract(db_window.data, '$.workspaceid')
    FROM db_window
);
