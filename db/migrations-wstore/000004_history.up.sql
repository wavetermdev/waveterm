CREATE TABLE history_migrated (
	historyid varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
	remotename varchar(200) NOT NULL,
	haderror boolean NOT NULL,
    cmdstr text NOT NULL,
	exitcode int NULL DEFAULT NULL, 
	durationms int NULL DEFAULT NULL
);
