--- removes all ai: keys except ai:preset
UPDATE db_block
SET data = json_remove(
    db_block.data,
    '$.meta.ai:*',
    '$.meta.ai:apitype',
    '$.meta.ai:baseurl',
    '$.meta.ai:apitoken',
    '$.meta.ai:name',
    '$.meta.ai:model',
    '$.meta.ai:orgid',
    '$.meta.ai:apiversion',
    '$.meta.ai:maxtokens',
    '$.meta.ai:timeoutms',
    '$.meta.ai:fontsize',
    '$.meta.ai:fixedfontsize'
)
WHERE json_extract(data, '$.meta.view') = 'waveai';