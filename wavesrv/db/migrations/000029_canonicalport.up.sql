UPDATE remote
SET remotecanonicalname = case when json_extract(sshopts, '$.issudo') then 'sudo@' else '' end ||
       remoteuser || '@' || remotehost || COALESCE(':' || json_extract(sshopts, '$.sshport'), '')
WHERE json_extract(sshopts, '$.sshport') != 22;