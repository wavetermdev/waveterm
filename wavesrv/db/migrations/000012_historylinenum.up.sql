ALTER TABLE history ADD COLUMN linenum int NOT NULL DEFAULT 0;

UPDATE history
SET linenum = COALESCE((SELECT line.linenum FROM line WHERE line.lineid = history.lineid), 0)
;

