CREATE TABLE webptypos (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    ptypos bigint NOT NULL,
    PRIMARY KEY (screenid, cmdid)
);

CREATE INDEX idx_screenupdate_ids ON screenupdate (screenid, lineid);
