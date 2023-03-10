ALTER TABLE session DROP COLUMN accesskey;
ALTER TABLE session DROP COLUMN ownerid;

CREATE TABLE cloud_session (
    sessionid varchar(36) PRIMARY KEY,
    viewkey varchar(50) NOT NULL,
    writekey varchar(50) NOT NULL,
    enckey varchar(100) NOT NULL,
    enctype varchar(50) NOT NULL,
    vts bigint NOT NULL,
    acl json NOT NULL
);

CREATE TABLE cloud_update (
    updateid varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
    updatetype varchar(50) NOT NULL,
    updatekeys json NOT NULL
);

