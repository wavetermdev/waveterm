UPDATE remote
SET sshopts = json_set(sshopts, '$.sshconfigsrc', 'waveterm-manual');
