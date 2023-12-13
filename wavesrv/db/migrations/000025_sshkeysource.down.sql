UPDATE remote
SET sshopts = json_remove(sshopts, '$.sshconfigsrc');