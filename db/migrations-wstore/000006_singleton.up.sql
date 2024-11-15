CREATE TABLE db_singleton (
	otype varchar(36) PRIMARY KEY,
    oid varchar(36) NOT NULL,
    version int NOT NULL,
    data json NOT NULL
);

INSERT INTO db_singleton (otype, oid, version, data)
SELECT 'client', oid, version, data
FROM db_client;

DROP TABLE db_client;

