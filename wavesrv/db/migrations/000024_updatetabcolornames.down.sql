UPDATE screen 
SET screenopts = json_set(screenopts, '$.tabcolor', 'black') 
WHERE json_extract(screenopts, '$.tabcolor') = 'null';
