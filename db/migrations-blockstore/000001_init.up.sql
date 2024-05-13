CREATE TABLE db_block_file (
    blockid varchar(36) NOT NULL,
    name varchar(200) NOT NULL,
    size bigint NOT NULL,
    createdts bigint NOT NULL,
    modts bigint NOT NULL,
    opts json NOT NULL,
    meta json NOT NULL,
    PRIMARY KEY (blockid, name)
);

CREATE TABLE db_block_data (
    blockid varchar(36) NOT NULL,
    name varchar(200) NOT NULL,
    partidx int NOT NULL,
    data blob NOT NULL,
    PRIMARY KEY(blockid, name, partidx)
);

