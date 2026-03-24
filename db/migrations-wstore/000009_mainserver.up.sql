CREATE TABLE IF NOT EXISTS db_mainserver (
    oid varchar(36) PRIMARY KEY,
    version int NOT NULL,
    data json NOT NULL
);
