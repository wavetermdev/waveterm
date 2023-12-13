DELETE FROM remote WHERE sshopts->>'sshconfigsrc' != 'waveterm-manual';

UPDATE remote
SET sshopts = json_remove(sshopts, '$.sshconfigsrc');