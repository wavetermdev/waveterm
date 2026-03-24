CREATE TABLE IF NOT EXISTS db_job (
    oid varchar(36) PRIMARY KEY,
    version int NOT NULL,
    data json NOT NULL
);
