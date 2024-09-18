CREATE TABLE db_wave_file (
    zoneid varchar(36) NOT NULL,
    name varchar(200) NOT NULL,
    size bigint NOT NULL,
    createdts bigint NOT NULL,
    modts bigint NOT NULL,
    opts json NOT NULL,
    meta json NOT NULL,
    PRIMARY KEY (zoneid, name)
);

CREATE TABLE db_file_data (
    zoneid varchar(36) NOT NULL,
    name varchar(200) NOT NULL,
    partidx int NOT NULL,
    data blob NOT NULL,
    PRIMARY KEY(zoneid, name, partidx)
);

