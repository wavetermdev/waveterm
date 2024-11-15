CREATE TABLE db_client (
    oid varchar(36) PRIMARY KEY,
    version int NOT NULL,
    data json NOT NULL
);

INSERT INTO db_client (oid, version, data)
SELECT oid, version, data
FROM db_singleton
WHERE otype = 'client';

DROP TABLE db_singleton;