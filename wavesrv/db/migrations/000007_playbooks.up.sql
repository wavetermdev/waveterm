CREATE TABLE playbook (
    playbookid varchar(36) PRIMARY KEY,
    playbookname varchar(100) NOT NULL,
    description text NOT NULL,
    entryids json NOT NULL
);

CREATE TABLE playbook_entry (
    entryid varchar(36) PRIMARY KEY,
    playbookid varchar(36) NOT NULL,
    description text NOT NULL,
    alias varchar(50) NOT NULL,
    cmdstr text NOT NULL,
    createdts bigint NOT NULL,
    updatedts bigint NOT NULL
);
