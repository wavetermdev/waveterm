UPDATE remote
SET sshopts = json_set(sshopts, '$.sshconfigsrc', json('waveterm-manual'));
