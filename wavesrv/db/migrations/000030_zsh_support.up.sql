ALTER TABLE remote_instance ADD COLUMN shelltype varchar(20) NOT NULL DEFAULT 'bash';
ALTER TABLE remote ADD COLUMN shellpref varchar(20) NOT NULL DEFAULT 'detect';
