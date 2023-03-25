CREATE TABLE screenupdate (
    updateid integer PRIMARY KEY,
    screenid varchar(36) NOT NULL,
    lineid varchar(36) NOT NULL,
    updatetype varchar(50) NOT NULL,
    updatets bigint NOT NULL
);

ALTER TABLE screen ADD COLUMN webshareopts json NOT NULL DEFAULT 'null';

