-- Initialize 'confirmflags' if it doesn't exist
UPDATE client
SET clientopts = json_set(
    clientopts, 
    '$.confirmflags', 
    json(
        CASE
            WHEN json_extract(clientopts, '$.confirmflags') IS NULL THEN '{}'
            ELSE json_extract(clientopts, '$.confirmflags')
        END
    )
);

-- Set or update a flag within 'confirmflags'
UPDATE client
SET clientopts = json_set(
    clientopts, 
    '$.confirmflags.showShellPrompt', 
    json('true')
);
