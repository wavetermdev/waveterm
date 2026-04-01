-- Drop ZeroAI tables
DROP INDEX IF EXISTS idx_zeroai_messages_created_at;
DROP INDEX IF EXISTS idx_zeroai_messages_session_id;
DROP TABLE IF EXISTS zeroai_messages;

DROP INDEX IF EXISTS idx_zeroai_sessions_work_dir;
DROP INDEX IF EXISTS idx_zeroai_sessions_created_at;
DROP INDEX IF EXISTS idx_zeroai_sessions_backend;
DROP TABLE IF EXISTS zeroai_sessions;
