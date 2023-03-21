DELETE FROM cmd
WHERE screenid = '';

DELETE FROM line
WHERE screenid = '';

DELETE FROM cmd
WHERE cmdid NOT IN (SELECT cmdid FROM line);

DELETE FROM line
WHERE cmdid <> '' AND cmdid NOT IN (SELECT cmdid FROM cmd);

CREATE TABLE new_bookmark_cmd (
    bookmarkid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (bookmarkid, screenid, cmdid)
);
INSERT INTO new_bookmark_cmd
SELECT
    b.bookmarkid,
    c.screenid,
    c.cmdid
FROM bookmark_cmd b, cmd c
WHERE b.cmdid = c.cmdid;
DROP TABLE bookmark_cmd;
ALTER TABLE new_bookmark_cmd RENAME TO bookmark_cmd;

ALTER TABLE client ADD COLUMN cmdstoretype varchar(20) DEFAULT 'session';

CREATE TABLE cmd_migrate (
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL
);
INSERT INTO cmd_migrate
SELECT sessionid, screenid, cmdid
FROM cmd;

-- update primary key for screen
CREATE TABLE new_screen (
    screenid varchar(36) NOT NULL,
    sessionid varchar(36) NOT NULL,
    name varchar(50) NOT NULL,
    screenidx int NOT NULL,
    screenopts json NOT NULL,
    ownerid varchar(36) NOT NULL,
    sharemode varchar(12) NOT NULL,
    curremoteownerid varchar(36) NOT NULL,
    curremoteid varchar(36) NOT NULL,
    curremotename varchar(50) NOT NULL,
    nextlinenum int NOT NULL,
    selectedline int NOT NULL,
    anchor json NOT NULL,
    focustype varchar(12) NOT NULL,
    archived boolean NOT NULL,
    archivedts bigint NOT NULL,
    PRIMARY KEY (screenid)
);
INSERT INTO new_screen
SELECT screenid, sessionid, name, screenidx, screenopts, ownerid, sharemode,
       curremoteownerid, curremoteid, curremotename, nextlinenum, selectedline,
       anchor, focustype, archived, archivedts
FROM screen;
DROP TABLE screen;
ALTER TABLE new_screen RENAME TO screen;

-- drop sessionid from line
CREATE TABLE new_line (
    screenid varchar(36) NOT NULL,
    userid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    ts bigint NOT NULL,
    linenum int NOT NULL,
    linenumtemp boolean NOT NULL,
    linetype varchar(10) NOT NULL,
    linelocal boolean NOT NULL,
    text text NOT NULL,
    cmdid varchar(36) NOT NULL,
    ephemeral boolean NOT NULL,
    contentheight int NOT NULL,
    star int NOT NULL,
    archived boolean NOT NULL,
    renderer varchar(50) NOT NULL,
    bookmarked boolean NOT NULL,
    PRIMARY KEY (screenid, lineid)
);
INSERT INTO new_line
SELECT screenid, userid, lineid, ts, linenum, linenumtemp, linetype, linelocal,
       text, cmdid, ephemeral, contentheight, star, archived, renderer, bookmarked
FROM line;
DROP TABLE line;
ALTER TABLE new_line RENAME TO line;

-- drop sessionid from cmd
CREATE TABLE new_cmd (
    screenid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
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
    startpk json NOT NULL,
    doneinfo json NOT NULL,
    runout json NOT NULL,
    rtnstate boolean NOT NULL,
    rtnbasehash varchar(36) NOT NULL,
    rtndiffhasharr json NOT NULL,
    PRIMARY KEY (screenid, cmdid)
);
INSERT INTO new_cmd
SELECT screenid, cmdid, remoteownerid, remoteid, remotename, cmdstr, cmdstr,
       festate, statebasehash, statediffhasharr, termopts, origtermopts, status, startpk, doneinfo, runout, rtnstate, rtnbasehash, rtndiffhasharr
FROM cmd;
DROP TABLE cmd;
ALTER TABLE new_cmd RENAME TO cmd;
