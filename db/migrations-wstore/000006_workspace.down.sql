UPDATE db_window
SET data = json_set(
    db_window.data, 
    '$.activetabid', 
    (SELECT json_extract(db_workspace.data, '$.activetabid') FROM db_workspace WHERE db_workspace.oid = json_extract(db_window.data, '$.workspaceid'))
)
WHERE db_window.oid IN (
    SELECT oid 
    FROM db_window 
    WHERE EXISTS (
        SELECT 1 
        FROM db_workspace 
        WHERE db_workspace.oid = json_extract(db_window.data, '$.workspaceid')
    )
);
