CREATE TABLE activity (
    day varchar(20) PRIMARY KEY,
    uploaded boolean NOT NULL,
    numcommands int NOT NULL,
    activeminutes int NOT NULL,
    fgminutes int NOT NULL,
    openminutes int NOT NULL,
    tzname varchar(50) NOT NULL,
    tzoffset int NOT NULL,
    clientversion varchar(20) NOT NULL,
    clientarch varchar(20) NOT NULL
);

ALTER TABLE client ADD COLUMN clientopts json NOT NULL DEFAULT '';
