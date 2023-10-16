DROP TABLE bookmark;
DROP TABLE bookmark_order;
DROP TABLE bookmark_cmd;

ALTER TABLE line DROP COLUMN bookmarked;
ALTER TABLE line DROP COLUMN pinned;
