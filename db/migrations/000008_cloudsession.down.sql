ALTER TABLE session ADD COLUMN accesskey DEFAULT '';
ALTER TABLE session ADD COLUMN ownerid DEFAULT '';

DROP TABLE cloud_session;
