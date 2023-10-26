UPDATE screen 
SET screenopts = json_set(screenopts, '$.tabcolor', 'null') 
WHERE json_extract(screenopts, '$.tabcolor') = 'black';
