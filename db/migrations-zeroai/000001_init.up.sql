-- ZeroAI Sessions table
CREATE TABLE IF NOT EXISTS zeroai_sessions (
    session_id TEXT PRIMARY KEY,
    backend TEXT NOT NULL,
    work_dir TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    thinking_level TEXT DEFAULT 'medium',
    yolo_mode INTEGER DEFAULT 0,
    acp_session_id TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zeroai_sessions_backend ON zeroai_sessions(backend);
CREATE INDEX IF NOT EXISTS idx_zeroai_sessions_created_at ON zeroai_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zeroai_sessions_work_dir ON zeroai_sessions(work_dir);

-- ZeroAI Messages table
CREATE TABLE IF NOT EXISTS zeroai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    event_type TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES zeroai_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zeroai_messages_session_id ON zeroai_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_zeroai_messages_created_at ON zeroai_messages(created_at);
