-- Step 1: Update db_workspace.data to set the $.activetabid field
UPDATE db_workspace
SET data = json_set(
    db_workspace.data,
    '$.activetabid',
    (SELECT json_extract(db_window.data, '$.activetabid'))
)
FROM db_window
WHERE db_workspace.oid IN (
    SELECT json_extract(db_window.data, '$.workspaceid')
);

-- Step 2: Remove the $.activetabid field from db_window.data
UPDATE db_window
SET data = json_remove(data, '$.activetabid')
WHERE json_extract(data, '$.workspaceid') IN (
    SELECT oid FROM db_workspace
);
