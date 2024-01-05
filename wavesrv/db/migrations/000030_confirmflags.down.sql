-- Remove 'confirmflags' from 'clientopts'
UPDATE client
SET clientopts = json_remove(clientopts, '$.confirmflags');
