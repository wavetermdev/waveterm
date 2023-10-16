UPDATE remote
SET sshopts = json_set(sshopts, '$.issudo', json('true'))
WHERE remotesudo
;

ALTER TABLE remote DROP COLUMN remotesudo;

ALTER TABLE remote DROP COLUMN physicalid;

ALTER TABLE remote ADD COLUMN openaiopts json NOT NULL DEFAULT '{}';

