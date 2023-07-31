-- remove cmdid from line, history, and cmd (use lineid everywhere)

CREATE TABLE cmd_new (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    remotename varchar(50) NOT NULL,
    cmdstr text NOT NULL,
    rawcmdstr text NOT NULL,
    festate json NOT NULL,
    statebasehash varchar(36) NOT NULL,
    statediffhasharr json NOT NULL,
    termopts json NOT NULL,
    origtermopts json NOT NULL,
    status varchar(10) NOT NULL,
    cmdpid int NOT NULL,
    remotepid int NOT NULL,
    donets bigint NOT NULL,
    exitcode int NOT NULL,
    durationms int NOT NULL,
    rtnstate boolean NOT NULL,
    rtnbasehash varchar(36) NOT NULL,
    rtndiffhasharr json NOT NULL,
    runout json NOT NULL,
    PRIMARY KEY (screenid, lineid)
);

CREATE TABLE cmd_migrate20 (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (screenid, lineid)
);

INSERT INTO cmd_migrate20
SELECT screenid, lineid, cmdid
FROM line;

INSERT INTO cmd_new
SELECT
    c.screenid,
    l.lineid,
    c.remoteownerid,
    c.remoteid,
    c.remotename,
    c.cmdstr,
    c.rawcmdstr,
    c.festate,
    c.statebasehash,
    c.statediffhasharr,
    c.termopts,
    c.origtermopts,
    c.status,
    coalesce(json_extract(startpk, '$.pid'), 0),
    coalesce(json_extract(startpk, '$.mshellpid'), 0),
    coalesce(json_extract(doneinfo, '$.ts'), 0),
    coalesce(json_extract(doneinfo, '$.exitcode'), 0),
    coalesce(json_extract(doneinfo, '$.durationms'), 0),
    c.rtnstate,
    c.rtnbasehash,
    c.rtndiffhasharr,
    c.runout
FROM cmd c
JOIN line l ON (l.cmdid = c.cmdid);

DROP TABLE cmd;

ALTER TABLE cmd_new RENAME TO cmd;

ALTER TABLE history DROP COLUMN cmdid;
ALTER TABLE line DROP COLUMN cmdid;
