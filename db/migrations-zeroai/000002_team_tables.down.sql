DROP INDEX IF EXISTS idx_zeroai_team_tasks_created_at;
DROP INDEX IF EXISTS idx_zeroai_team_tasks_priority;
DROP INDEX IF EXISTS idx_zeroai_team_tasks_owner_agent;
DROP INDEX IF EXISTS idx_zeroai_team_tasks_status;
DROP INDEX IF EXISTS idx_zeroai_team_tasks_team_id;
DROP TABLE IF EXISTS zeroai_team_tasks;

DROP INDEX IF EXISTS idx_zeroai_team_members_role;
DROP INDEX IF EXISTS idx_zeroai_team_members_agent_id;
DROP INDEX IF EXISTS idx_zeroai_team_members_team_id;
DROP TABLE IF EXISTS zeroai_team_members;

DROP INDEX IF EXISTS idx_zeroai_teams_created_at;
DROP INDEX IF EXISTS idx_zeroai_teams_name;
DROP TABLE IF EXISTS zeroai_teams;
