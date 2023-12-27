ALTER TABLE history ADD COLUMN incognito boolean NOT NULL DEFAULT false;
ALTER TABLE history DROP COLUMN exitcode;
ALTER TABLE history DROP COLUMN durationms;
ALTER TABLE history DROP COLUMN festate;
ALTER TABLE history DROP COLUMN tags;
ALTER TABLE history DROP COLUMN status;
