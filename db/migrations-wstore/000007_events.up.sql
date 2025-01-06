CREATE TABLE db_tevent (
   id int PRIMARY KEY,
   ts int NOT NULL,
   event varchar(50) NOT NULL,
   props json NOT NULL,
   uploaded boolean NOT NULL DEFAULT 0
);