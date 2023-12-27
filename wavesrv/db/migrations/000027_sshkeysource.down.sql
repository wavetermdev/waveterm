DELETE FROM remote WHERE sshconfigsrc != 'waveterm-manual';

ALTER TABLE remote DROP COLUMN sshconfigsrc;