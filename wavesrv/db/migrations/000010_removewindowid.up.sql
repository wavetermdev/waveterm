ALTER TABLE remote_instance RENAME COLUMN windowid TO screenid;
ALTER TABLE line RENAME COLUMN windowid TO screenid;

UPDATE remote_instance
SET screenid = COALESCE((SELECT screen.screenid FROM screen WHERE screen.windowid = remote_instance.screenid), '')
WHERE screenid <> ''
;

UPDATE line
SET screenid = COALESCE((SELECT screen.screenid FROM screen WHERE screen.windowid = line.screenid), '')
WHERE screenid <> ''
;

ALTER TABLE history DROP COLUMN windowid;
ALTER TABLE screen DROP COLUMN windowid;


