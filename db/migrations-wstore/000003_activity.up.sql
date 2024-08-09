CREATE TABLE db_activity (
    day varchar(20) PRIMARY KEY,
    uploaded boolean NOT NULL,
    tdata json NOT NULL,
    tzname varchar(50) NOT NULL,
    tzoffset int NOT NULL,
    clientversion varchar(20) NOT NULL,
    clientarch varchar(20) NOT NULL,
    buildtime varchar(20) NOT NULL DEFAULT '-',
    osrelease varchar(20) NOT NULL DEFAULT '-'
);