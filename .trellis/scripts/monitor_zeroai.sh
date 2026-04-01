#!/bin/bash
# ZeroAI Phase 1 Phased Execution Monitor
# Automatically tracks team completion and starts next phase

set -e

PHASE1_TEAM="zeroai-sprint1-types-e4076c"
PHASE2_TEAM="zeroai-sprint2-protocol-6c04fa"
PHASE3_TEAM="zeroai-sprint3-agent-core-[a-f0-9]+"
PHASE4_TEAM="zeroai-sprint4-adapters-[a-f0-9]+"
PHASE5_TEAM="zeroai-sprint5-services-[a-f0-9]+"
PHASE6_TEAM="zeroai-sprint6-rpc-[a-f0-9]+"
PHASE7_TEAM="zeroai-sprint7-frontend-[a-f0-9]+"

LOG_FILE="/tmp/zeroai-monitor.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

get_team_status() {
    local team="$1"
    clawteam board show "$team" 2>/dev/null | grep -oE 'PENDING \([0-9]+\)|IN PROGRESS \([0-9]+\)|COMPLETED \([0-9]+\)' || echo ""
}

is_team_completed() {
    local team="$1"
    local status=$(clawteam board show "$team" 2>/dev/null)
    # Check if team is still running (has members) and has completed all tasks
    local completed=$(echo "$status" | grep -o 'COMPLETED' | wc -l)
    local total=$(echo "$status" | grep -oE 'Task Board \([0-9]+ total\)' | grep -oE '[0-9]+' || echo "0")

    if [ "$total" -eq "0" ]; then
        # No tasks, check if it should have tasks based on phase
        case "$team" in
            *sprint4-*)
                # Adapters team should have 5 pre-generated tasks
                [ "$completed" -ge "5" ] && echo "true" || echo "false"
                ;;
            *)
                echo "false"
                ;;
        esac
    else
        [ "$completed" -ge "$total" ] && echo "true" || echo "false"
    fi
}

launch_team() {
    local template="$1"
    local goal="$2"

    log "🚀 Launching $template with goal: $goal"

    # Find actual team name after launch
    local result=$(clawteam launch "$template" -g "$goal" --backend wsh 2>&1)
    local new_team=$(echo "$result" | grep -oE "Team '[a-z0-9-]+' launched" | cut -d"'" -f2)

    if [ -n "$new_team" ]; then
        log "✅ Team $new_team launched successfully"
        # Send start message
        local leader=$(clawteam board show "$new_team" 2>/dev/null | grep -oE 'Leader: [a-z0-9-]+' | cut -d' ' -f2)
        clawteam inbox send "$new_team" "$leader" "START: Begin phase implementation. Check dependencies and coordinate with other teams." 2>/dev/null
        echo "$new_team"
    else
        log "❌ Failed to launch $template"
        echo ""
    fi
}

find_team_id() {
    local pattern="$1"
    ls ~/.clawteam/teams/ | grep -E "$pattern" | head -1
}

check_and_respawn_workers() {
    local team_id="$1"

    # Check if workers need respawning
    local registry="$HOME/.clawteam/teams/$team_id/spawn_registry.json"
    if [ -f "$registry" ]; then
        # Find dead subprocess workers
        local dead_workers=$(jq -r '.[] | select(.backend == "subprocess" and .pid != 0) | "\(.key):\(.pid)"' "$registry" 2>/dev/null || true)

        if [ -n "$dead_workers" ]; then
            while IFS=: read -r name pid; do
                if ! ps -p "$pid" > /dev/null 2>&1; then
                    log "⚠️  Dead worker detected: $name (was PID $pid)"
                    log "🔄 Respawning $name for $team_id..."

                    # Get agent type from registry
                    local agent_type=$(jq -r ".\"$name\".command[0]" "$registry" 2>/dev/null | grep "general-purpose" > /dev/null && echo "general-purpose" || echo "leader")

                    # Respawn the worker
                    local result=$(clawteam spawn --team "$team_id" --agent-name "$name" --agent-type "$agent_type" subprocess 2>&1)

                    local new_pid=$(echo "$result" | grep -oE 'pid=[0-9]+' | cut -d= -f2)
                    if [ -n "$new_pid" ]; then
                        log "✅ Worker $name respawned with PID $new_pid"
                        # Send notification
                        clawteam inbox send "$team_id" "$name" "WORKER RESUMED: You were automatically respawned. Check your tasks and continue working." 2>/dev/null
                    else
                        log "❌ Failed to respawn worker $name"
                    fi
                fi
            done <<< "$dead_workers"
        fi
    fi
}

monitor_phase() {
    local phase_name="$1"
    local teams=("${@:2}")

    log "🔍 Monitoring Phase: $phase_name"
    log "   Teams: ${teams[*]}"

    local all_complete=false

    while [ "$all_complete" = "false" ]; do
        local pending_count=0
        local all_done=true

        for team in "${teams[@]}"; do
            local team_id=$(find_team_id "$team")

            if [ -n "$team_id" ]; then
                # Check for and respawn dead workers
                check_and_respawn_workers "$team_id"

                local status=$(get_team_status "$team_id")
                local completed=$(is_team_completed "$team_id")

                log "   $team_id: $status (completed: $completed)"

                if [ "$completed" = "false" ]; then
                    all_done=false
                    pending_count=$((pending_count + 1))
                fi
            else
                log "   WARN: Team not found for pattern: $team"
                all_done=false
            fi
        done

        if [ "$all_done" = "true" ]; then
            log "✅ Phase $phase_name COMPLETE!"
            all_complete=true
        else
            log "⏳ Phase $phase_name in progress... $pending_count team(s) still working"
            sleep 60  # Check every minute
        fi
    done
}

main() {
    log "🎯 ZeroAI Phase 1 Phased Execution Monitor Started"

    # Phase 1: Types + Protocol
    log "📍 PHASE 1: Types + Protocol"
    monitor_phase "Types + Protocol" "$PHASE1_TEAM" "$PHASE2_TEAM"

    # Launch Phase 2: Agent Core
    log "📍 PHASE 2: Launching Agent Core"
    local agent_core_team=$(launch_team "zeroai-sprint3-agent-core" "Implement ACP Agent Core")
    if [ -n "$agent_core_team" ]; then
        monitor_phase "Agent Core" "zeroai-sprint3-agent-core"
    fi

    # Launch Phase 3: Adapters
    log "📍 PHASE 3: Launching Adapters"
    local adapters_team=$(launch_team "zeroai-sprint4-adapters" "Implement Backend Adapters")
    if [ -n "$adapters_team" ]; then
        monitor_phase "Adapters" "zeroai-sprint4-adapters"
    fi

    # Launch Phase 4: Services
    log "📍 PHASE 4: Launching Services"
    local services_team=$(launch_team "zeroai-sprint5-services" "Implement Service Layer")
    if [ -n "$services_team" ]; then
        monitor_phase "Services" "zeroai-sprint5-services"
    fi

    # Launch Phase 5: RPC
    log "📍 PHASE 5: Launching RPC"
    local rpc_team=$(launch_team "zeroai-sprint6-rpc" "Implement RPC Layer")
    if [ -n "$rpc_team" ]; then
        monitor_phase "RPC" "zeroai-sprint6-rpc"
    fi

    # Launch Phase 6: Frontend
    log "📍 PHASE 6: Launching Frontend"
    local frontend_team=$(launch_team "zeroai-sprint7-frontend" "Implement Frontend UI")
    if [ -n "$frontend_team" ]; then
        monitor_phase "Frontend" "zeroai-sprint7-frontend"
    fi

    log "🎉 ZeroAI Phase 1 COMPLETE!"
}

# Run the monitor
main "$@"
