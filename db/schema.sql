CREATE TABLE schema_migrations (version uint64,dirty bool);
CREATE UNIQUE INDEX version_unique ON schema_migrations (version);
CREATE TABLE session (
    sessionid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL
);
CREATE UNIQUE INDEX session_name_unique ON session(name);
CREATE TABLE window (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    name varchar(50) NOT NULL,
    curremote varchar(50) NOT NULL,
    version int NOT NULL,
    PRIMARY KEY (sessionid, windowid)
);
CREATE UNIQUE INDEX window_name_unique ON window(sessionid, name);
CREATE TABLE session_remote (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    remotename varchar(50) NOT NULL,
    remoteid varchar(36) NOT NULL,
    cwd varchar(300) NOT NULL,
    PRIMARY KEY (sessionid, windowid, remotename)
);
CREATE TABLE line (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    lineid int NOT NULL,
    userid varchar(36) NOT NULL,
    ts bigint NOT NULL,
    linetype varchar(10) NOT NULL,
    text text NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (sessionid, windowid, lineid)
);
CREATE TABLE remote (
    remoteid varchar(36) PRIMARY KEY,
    remotetype varchar(10) NOT NULL,
    remotename varchar(50) NOT NULL,
    connectopts varchar(300) NOT NULL
);
CREATE TABLE session_cmd (
    sessionid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    status varchar(10) NOT NULL,
    startts bigint NOT NULL,
    pid int NOT NULL,
    runnerpid int NOT NULL,
    donets bigint NOT NULL,
    exitcode int NOT NULL,
    ptyout BLOB NOT NULL,
    runout BLOB NOT NULL,
    PRIMARY KEY (sessionid, cmdid)
);
CREATE TABLE history (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    userid varchar(36) NOT NULL,
    ts int64 NOT NULL,
    lineid varchar(36) NOT NULL,
    PRIMARY KEY (sessionid, windowid, lineid)
);
