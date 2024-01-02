ALTER TABLE history DROP COLUMN incognito;
ALTER TABLE history ADD COLUMN exitcode int NULL DEFAULT NULL;
ALTER TABLE history ADD COLUMN durationms int NULL DEFAULT NULL;
ALTER TABLE history ADD COLUMN festate json NOT NULL DEFAULT '{}';
ALTER TABLE history ADD COLUMN tags json NOT NULL DEFAULT '{}';
ALTER TABLE history ADD COLUMN status varchar(10) NOT NULL DEFAULT 'unknown';

UPDATE cmd
SET festate = json_remove(festate, "$.PROMPTVAR_GITBRANCH")
WHERE festate->>'PROMPTVAR_GITBRANCH' = '';

UPDATE history
SET exitcode = cmd.exitcode,
    durationms = cmd.durationms,
    festate = cmd.festate,
    status = cmd.status
FROM cmd
WHERE history.screenid = cmd.screenid
  AND history.lineid = cmd.lineid;

UPDATE history
SET status = 'done'
WHERE lineid = '';

CREATE TABLE session_tombstone (
    sessionid varchar(36) PRIMARY KEY,
    deletedts bigint NOT NULL,
    name varchar(50) NOT NULL
);

CREATE TABLE screen_tombstone (
    screenid varchar(36) PRIMARY KEY,
    sessionid varchar(36) NOT NULL,
    deletedts bigint NOT NULL,
    screenopts json NOT NULL,
    name varchar(50) NOT NULL
);


