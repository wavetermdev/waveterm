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

CREATE TABLE remote_instance (
    riid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL,
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    sessionscope boolean NOT NULL,
    state json NOT NULL
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
    autoconnect boolean NOT NULL,

    -- ssh specific opts
    sshhost varchar(300) NOT NULL,
    sshopts varchar(300) NOT NULL,
    sshidentity varchar(300) NOT NULL,
    sshuser varchar(100) NOT NULL,

    -- runtime data
    lastconnectts bigint NOT NULL,
    ptyout BLOB NOT NULL
);

CREATE TABLE session_cmd (
    sessionid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    rsid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    remotestate json NOT NULL,
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
    ts bigint NOT NULL,
    lineid varchar(36) NOT NULL,
    PRIMARY KEY (sessionid, windowid, lineid)
);
