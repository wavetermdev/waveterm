CREATE TABLE schema_migrations (version uint64,dirty bool);
CREATE UNIQUE INDEX version_unique ON schema_migrations (version);
CREATE TABLE block_file (
    blockid varchar(36) NOT NULL,
    name varchar(200) NOT NULL,
    maxsize bigint NOT NULL,
    circular boolean NOT NULL,
    size bigint NOT NULL,
    createdts bigint NOT NULL,
    modts bigint NOT NULL,
    meta json NOT NULL,
    PRIMARY KEY (blockid, name)
);

CREATE TABLE block_data (
    blockid varchar(36) NOT NULL,
    name varchar(36) NOT NULL,
    partidx int NOT NULL,
    data blob NOT NULL,
    PRIMARY KEY(blockid, name, partidx)
);