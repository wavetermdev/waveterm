-- ZeroAI Teams table
CREATE TABLE IF NOT EXISTS zeroai_teams (
    team_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zeroai_teams_name ON zeroai_teams(name);
CREATE INDEX IF NOT EXISTS idx_zeroai_teams_created_at ON zeroai_teams(created_at DESC);

-- ZeroAI Team Members table
CREATE TABLE IF NOT EXISTS zeroai_team_members (
    member_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'worker',
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES zeroai_teams(team_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zeroai_team_members_team_id ON zeroai_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_zeroai_team_members_agent_id ON zeroai_team_members(agent_id);
CREATE INDEX IF NOT EXISTS idx_zeroai_team_members_role ON zeroai_team_members(role);

-- ZeroAI Team Tasks table
CREATE TABLE IF NOT EXISTS zeroai_team_tasks (
    task_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    owner_agent TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES zeroai_teams(team_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zeroai_team_tasks_team_id ON zeroai_team_tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_zeroai_team_tasks_status ON zeroai_team_tasks(status);
CREATE INDEX IF NOT EXISTS idx_zeroai_team_tasks_owner_agent ON zeroai_team_tasks(owner_agent);
CREATE INDEX IF NOT EXISTS idx_zeroai_team_tasks_priority ON zeroai_team_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_zeroai_team_tasks_created_at ON zeroai_team_tasks(created_at DESC);
