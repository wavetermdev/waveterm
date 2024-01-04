UPDATE remote
SET remotecanonicalname = remotecanonicalname || COALESCE( ":" || json_extract(sshopts, '$.sshport'), "")
WHERE json_extract(sshopts, '$.sshport') != 22;