CREATE TABLE new_screen (
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
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
    PRIMARY KEY (sessionid, screenid)
);

INSERT INTO new_screen
SELECT
    s.sessionid,
    s.screenid,
    w.windowid,
    s.name,
    s.screenidx,
    json_patch(s.screenopts, w.winopts),
    s.ownerid,
    s.sharemode,
    w.curremoteownerid,
    w.curremoteid,
    w.curremotename,
    w.nextlinenum,
    sw.selectedline,
    sw.anchor,
    sw.focustype,
    s.archived,
    s.archivedts
FROM
    screen s,
    screen_window sw,
    window w
WHERE
    s.screenid = sw.screenid
    AND sw.windowid = w.windowid
;

DROP TABLE screen;
DROP TABLE screen_window;
DROP TABLE window;

ALTER TABLE new_screen RENAME TO screen;


