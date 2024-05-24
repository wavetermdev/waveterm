CREATE TABLE db_client (
    clientid varchar(36) PRIMARY KEY,  -- unnecessary, but useful to have a PK
    data json NOT NULL
);

CREATE TABLE db_window (
    windowid varchar(36) PRIMARY KEY,
    data json NOT NULL
);

CREATE TABLE db_workspace (
    workspaceid varchar(36) PRIMARY KEY,
    data json NOT NULL
);

CREATE TABLE db_tab (
    tabid varchar(36) PRIMARY KEY,
    data json NOT NULL
);

CREATE TABLE db_block (
    blockid varchar(36) PRIMARY KEY,
    data json NOT NULL
);
