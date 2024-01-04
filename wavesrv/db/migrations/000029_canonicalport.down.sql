UPDATE remote
SET remotecanonicalname = SUBSTR(remotecanonicalname, 1, INSTR(remotecanonicalname, ':') - 1)
WHERE INSTR(remotecanonicalname, ':');

DELETE FROM remote
WHERE remoteid NOT IN (
    SELECT remoteid FROM (
        SELECT MIN(archived), remoteid, remotecanonicalname
        FROM remote
        GROUP BY remotecanonicalname
    )
);