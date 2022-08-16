CREATE TABLE client (
    userid varchar(36) NOT NULL,
    userpublickeybytes blob NOT NULL,
    userprivatekeybytes blob NOT NULL
);

CREATE TABLE session (
    sessionid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL,
    sessionidx int NOT NULL,
    activescreenid varchar(36) NOT NULL,
    notifynum int NOT NULL,
    owneruserid varchar(36) NOT NULL,
    sharemode varchar(12) NOT NULL,
    accesskey varchar(36) NOT NULL
);

CREATE TABLE window (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    curremote varchar(50) NOT NULL,
    winopts json NOT NULL,
    owneruserid varchar(36) NOT NULL,
    sharemode varchar(12) NOT NULL,
    shareopts json NOT NULL,
    PRIMARY KEY (sessionid, windowid)
);

CREATE TABLE screen (
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    name varchar(50) NOT NULL,
    activewindowid varchar(36) NOT NULL,
    screenidx int NOT NULL,
    screenopts json NOT NULL,
    owneruserid varchar(36) NOT NULL,
    sharemode varchar(12) NOT NULL,
    PRIMARY KEY (sessionid, screenid)
);

CREATE TABLE screen_window (
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    name varchar(50) NOT NULL,
    layout json NOT NULL,
    PRIMARY KEY (sessionid, screenid, windowid)
);

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
    lineid varchar(36) NOT NULL,
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
    initpk json NOT NULL,
    sshopts json NOT NULL,
    lastconnectts bigint NOT NULL
);

CREATE TABLE cmd (
    sessionid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    cmdstr text NOT NULL,
    remotestate json NOT NULL,
    termopts json NOT NULL,
    status varchar(10) NOT NULL,
    startpk json NOT NULL,
    donepk json NOT NULL,
    runout json NOT NULL,
    usedrows int NOT NULL,
    PRIMARY KEY (sessionid, cmdid)
);

CREATE TABLE history (
    historyid varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
    userid varchar(36) NOT NULL,
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    lineid int NOT NULL,
    haderror boolean NOT NULL,
    cmdid varchar(36) NOT NULL,
    cmdstr text NOT NULL
);
