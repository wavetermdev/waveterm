CREATE TABLE bookmark (
    bookmarkid varchar(36) PRIMARY KEY,
    createdts bigint NOT NULL,
    cmdstr text NOT NULL,
    alias varchar(50) NOT NULL,
    tags json NOT NULL,
    description text NOT NULL
);

CREATE TABLE bookmark_order (
    tag varchar(50) NOT NULL,
    bookmarkid varchar(36) NOT NULL,
    orderidx int NOT NULL,
    PRIMARY KEY (tag, bookmarkid)
);

CREATE TABLE bookmark_cmd (
    bookmarkid varchar(36) NOT NULL,
    sessionid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (bookmarkid, sessionid, cmdid)
);

ALTER TABLE line ADD COLUMN bookmarked boolean NOT NULL DEFAULT 0;
ALTER TABLE line ADD COLUMN pinned boolean NOT NULL DEFAULT 0;

