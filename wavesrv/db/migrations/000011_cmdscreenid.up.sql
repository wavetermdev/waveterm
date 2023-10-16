ALTER TABLE cmd ADD COLUMN screenid varchar(36) NOT NULL DEFAULT '';

UPDATE cmd
SET screenid = (SELECT line.screenid FROM line WHERE line.cmdid = cmd.cmdid)
;
