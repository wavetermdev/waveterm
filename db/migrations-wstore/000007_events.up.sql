CREATE TABLE db_tevent (
   uuid varchar(36) PRIMARY KEY,
   ts int NOT NULL,
   tslocal varchar(100) NOT NULL,
   event varchar(50) NOT NULL,
   props json NOT NULL,
   uploaded boolean NOT NULL DEFAULT 0
);