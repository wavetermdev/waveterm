CREATE TABLE IF NOT EXISTS "bookmark_cmd" (
    bookmarkid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (bookmarkid, screenid, cmdid)
);

ALTER TABLE line ADD COLUMN bookmarked boolean NOT NULL DEFAULT 0;

