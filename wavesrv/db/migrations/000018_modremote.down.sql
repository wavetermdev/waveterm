ALTER TABLE remote ADD COLUMN remotesudo;

UPDATE remote
SET remotesudo = 1
WHERE json_extract(sshopts, '$.issudo')
;

UPDATE remote
SET sshopts = json_remove(sshopts, '$.issudo')
;

ALTER TABLE remote ADD COLUMN physicalid varchar(36) NOT NULL DEFAULT '';

ALTER TABLE remote DROP COLUMN openaiopts;
