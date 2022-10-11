CREATE TABLE client (
    clientid varchar(36) NOT NULL,
    userid varchar(36) NOT NULL,
    activesessionid varchar(36) NOT NULL,
    userpublickeybytes blob NOT NULL,
    userprivatekeybytes blob NOT NULL,
    winsize json NOT NULL
);

CREATE TABLE session (
    sessionid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL,
    sessionidx int NOT NULL,
    activescreenid varchar(36) NOT NULL,
    notifynum int NOT NULL,
    ownerid varchar(36) NOT NULL,
    sharemode varchar(12) NOT NULL,
    accesskey varchar(36) NOT NULL
);

CREATE TABLE window (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    curremoteownerid varchar(36) NOT NULL,
    curremoteid varchar(36) NOT NULL,
    curremotename varchar(50) NOT NULL,
    nextlinenum int NOT NULL,
    winopts json NOT NULL,
    ownerid varchar(36) NOT NULL,
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
    ownerid varchar(36) NOT NULL,
    sharemode varchar(12) NOT NULL,
    PRIMARY KEY (sessionid, screenid)
);

CREATE TABLE screen_window (
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    name varchar(50) NOT NULL,
    layout json NOT NULL,
    selectedline int NOT NULL,
    anchor json NOT NULL,
    focustype varchar(12) NOT NULL,
    PRIMARY KEY (sessionid, screenid, windowid)
);

CREATE TABLE remote_instance (
    riid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL,
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    state json NOT NULL
);

CREATE TABLE line (
    sessionid varchar(36) NOT NULL,
    windowid varchar(36) NOT NULL,
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
    PRIMARY KEY (sessionid, windowid, lineid)
);

CREATE TABLE remote (
    remoteid varchar(36) PRIMARY KEY,
    physicalid varchar(36) NOT NULL,
    remotetype varchar(10) NOT NULL,
    remotealias varchar(50) NOT NULL,
    remotecanonicalname varchar(200) NOT NULL,
    remotesudo boolean NOT NULL,
    remoteuser varchar(50) NOT NULL,
    remotehost varchar(200) NOT NULL,
    connectmode varchar(20) NOT NULL,
    autoinstall boolean NOT NULL,
    initpk json NOT NULL,
    sshopts json NOT NULL,
    remoteopts json NOT NULL,
    lastconnectts bigint NOT NULL,
    local boolean NOT NULL,
    archived boolean NOT NULL,
    remoteidx int NOT NULL
);

CREATE TABLE cmd (
    sessionid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    remotename varchar(50) NOT NULL,
    cmdstr text NOT NULL,
    remotestate json NOT NULL,
    termopts json NOT NULL,
    origtermopts json NOT NULL,
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
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    remotename varchar(50) NOT NULL,
    haderror boolean NOT NULL,
    cmdid varchar(36) NOT NULL,
    cmdstr text NOT NULL,
    ismetacmd boolean
);
