CREATE TABLE schema_migrations (version uint64,dirty bool);
CREATE UNIQUE INDEX version_unique ON schema_migrations (version);
CREATE TABLE client (
    clientid varchar(36) NOT NULL,
    userid varchar(36) NOT NULL,
    activesessionid varchar(36) NOT NULL,
    userpublickeybytes blob NOT NULL,
    userprivatekeybytes blob NOT NULL,
    winsize json NOT NULL
, clientopts json NOT NULL DEFAULT '', feopts json NOT NULL DEFAULT '{}', cmdstoretype varchar(20) DEFAULT 'session', openaiopts json NOT NULL DEFAULT '{}');
CREATE TABLE session (
    sessionid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL,
    sessionidx int NOT NULL,
    activescreenid varchar(36) NOT NULL,
    notifynum int NOT NULL,
    archived boolean NOT NULL,
    archivedts bigint NOT NULL,
    sharemode varchar(12) NOT NULL);
CREATE TABLE remote_instance (
    riid varchar(36) PRIMARY KEY,
    name varchar(50) NOT NULL,
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    festate json NOT NULL,
    statebasehash varchar(36) NOT NULL,
    statediffhasharr json NOT NULL
);
CREATE TABLE state_base (
    basehash varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
    version varchar(200) NOT NULL,
    data blob NOT NULL
);
CREATE TABLE state_diff (
    diffhash varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
    basehash varchar(36) NOT NULL,
    diffhasharr json NOT NULL,    
    data blob NOT NULL
);
CREATE TABLE remote (
    remoteid varchar(36) PRIMARY KEY,
    remotetype varchar(10) NOT NULL,
    remotealias varchar(50) NOT NULL,
    remotecanonicalname varchar(200) NOT NULL,
    remoteuser varchar(50) NOT NULL,
    remotehost varchar(200) NOT NULL,
    connectmode varchar(20) NOT NULL,
    autoinstall boolean NOT NULL,
    sshopts json NOT NULL,
    remoteopts json NOT NULL,
    lastconnectts bigint NOT NULL,
    local boolean NOT NULL,
    archived boolean NOT NULL,
    remoteidx int NOT NULL,
    statevars json NOT NULL DEFAULT '{}',
    sshconfigsrc varchar(36) NOT NULL DEFAULT 'waveterm-manual',
    openaiopts json NOT NULL DEFAULT '{}');
CREATE TABLE history (
    historyid varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
    userid varchar(36) NOT NULL,
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    lineid int NOT NULL,
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    remotename varchar(50) NOT NULL,
    haderror boolean NOT NULL,
    cmdstr text NOT NULL,
    ismetacmd boolean,
    incognito boolean
, linenum int NOT NULL DEFAULT 0);
CREATE TABLE activity (
    day varchar(20) PRIMARY KEY,
    uploaded boolean NOT NULL,
    tdata json NOT NULL,
    tzname varchar(50) NOT NULL,
    tzoffset int NOT NULL,
    clientversion varchar(20) NOT NULL,
    clientarch varchar(20) NOT NULL
, buildtime varchar(20) NOT NULL DEFAULT '-', osrelease varchar(20) NOT NULL DEFAULT '-');
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
CREATE TABLE playbook (
    playbookid varchar(36) PRIMARY KEY,
    playbookname varchar(100) NOT NULL,
    description text NOT NULL,
    entryids json NOT NULL
);
CREATE TABLE playbook_entry (
    entryid varchar(36) PRIMARY KEY,
    playbookid varchar(36) NOT NULL,
    description text NOT NULL,
    alias varchar(50) NOT NULL,
    cmdstr text NOT NULL,
    createdts bigint NOT NULL,
    updatedts bigint NOT NULL
);
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
CREATE TABLE cmd_migrate (
    sessionid varchar(36) NOT NULL,
    screenid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL
);
CREATE TABLE IF NOT EXISTS "screen" (
    screenid varchar(36) NOT NULL,
    sessionid varchar(36) NOT NULL,
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
    archivedts bigint NOT NULL, webshareopts json NOT NULL DEFAULT 'null',
    PRIMARY KEY (screenid)
);
CREATE TABLE IF NOT EXISTS "line" (
    screenid varchar(36) NOT NULL,
    userid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    ts bigint NOT NULL,
    linenum int NOT NULL,
    linenumtemp boolean NOT NULL,
    linetype varchar(10) NOT NULL,
    linelocal boolean NOT NULL,
    text text NOT NULL,
    ephemeral boolean NOT NULL,
    contentheight int NOT NULL,
    star int NOT NULL,
    archived boolean NOT NULL,
    renderer varchar(50) NOT NULL, linestate json NOT NULL DEFAULT '{}',
    PRIMARY KEY (screenid, lineid)
);
CREATE TABLE screenupdate (
    updateid integer PRIMARY KEY,
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    updatetype varchar(50) NOT NULL,
    updatets bigint NOT NULL
);
CREATE TABLE webptypos (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    ptypos bigint NOT NULL,
    PRIMARY KEY (screenid, lineid)
);
CREATE INDEX idx_screenupdate_ids ON screenupdate (screenid, lineid);
CREATE TABLE cmd_migration (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (screenid, lineid)
);
CREATE TABLE IF NOT EXISTS "cmd" (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    remoteownerid varchar(36) NOT NULL,
    remoteid varchar(36) NOT NULL,
    remotename varchar(50) NOT NULL,
    cmdstr text NOT NULL,
    rawcmdstr text NOT NULL,
    festate json NOT NULL,
    statebasehash varchar(36) NOT NULL,
    statediffhasharr json NOT NULL,
    termopts json NOT NULL,
    origtermopts json NOT NULL,
    status varchar(10) NOT NULL,
    cmdpid int NOT NULL,
    remotepid int NOT NULL,
    donets bigint NOT NULL,
    exitcode int NOT NULL,
    durationms int NOT NULL,
    rtnstate boolean NOT NULL,
    rtnbasehash varchar(36) NOT NULL,
    rtndiffhasharr json NOT NULL,
    runout json NOT NULL,
    PRIMARY KEY (screenid, lineid)
);
CREATE TABLE cmd_migrate20 (
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    cmdid varchar(36) NOT NULL,
    PRIMARY KEY (screenid, lineid)
);
