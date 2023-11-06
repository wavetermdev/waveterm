UPDATE screen 
SET screenopts = json_set(screenopts, '$.tabcolor', 'default') 
WHERE json_extract(screenopts, '$.tabcolor') = 'black' OR json_extract(screenopts, '$.tabcolor') = 'magenta';
