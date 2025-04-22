// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FC, useCallback, useState } from "react";
import { fireAndForget } from "../../util/promises";

interface AutonomousModeToggleProps {
    messageText: string;
    onExecuteCommand: (command: string) => Promise<void>;
    model?: any; // Not used anymore
}

/**
 * A toggle component for enabling autonomous mode in WaveAI
 */
const AutonomousModeToggle: FC<AutonomousModeToggleProps> = ({ messageText, onExecuteCommand }) => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [isRunning, setIsRunning] = useState(false);

    const handleToggle = useCallback(() => {
        if (isRunning) return; // Don't allow toggling while running

        const newValue = !isEnabled;
        setIsEnabled(newValue);
        console.log("Autonomous mode toggle clicked, new value:", newValue);

        if (newValue) {
            // Extract and execute commands directly
            fireAndForget(async () => {
                try {
                    setIsRunning(true);
                    console.log("Extracting commands from message text");

                    // Extract commands from message
                    const rawCommands = extractCommandsFromText(messageText);

                    if (rawCommands.length === 0) {
                        console.warn("No commands found to execute");
                        setIsEnabled(false);
                        setIsRunning(false);
                        return;
                    }

                    // Optimize commands to remove redundancy
                    const optimizedCommands = optimizeCommands(rawCommands);

                    // Show optimization message in the console
                    console.log(
                        `Optimized ${rawCommands.length} commands down to ${optimizedCommands.length} essential operations`
                    );
                    console.log("Commands to execute:", optimizedCommands);

                    // If we have a git workflow, add an informative message
                    if (
                        optimizedCommands.length === 2 &&
                        optimizedCommands[0].includes("git checkout") &&
                        optimizedCommands[1].includes("git pull")
                    ) {
                        // Extract branch names
                        const checkoutMatch = optimizedCommands[0].match(/checkout\s+([^\s]+)/);
                        const pullMatch = optimizedCommands[1].match(/pull\s+origin\s+([^\s]+)/);

                        if (checkoutMatch) {
                            const checkoutBranch = checkoutMatch[1];
                            const pullBranch = pullMatch ? pullMatch[1] : checkoutBranch;

                            // Add message using the onExecuteCommand to send a message to the terminal
                            await onExecuteCommand(
                                `echo "Optimizing git workflow: switching to ${checkoutBranch} branch and pulling latest changes from ${pullBranch}"`
                            );
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        }
                    } else if (rawCommands.length > optimizedCommands.length) {
                        // Add message about command optimization
                        await onExecuteCommand(
                            `echo "Optimized ${rawCommands.length} commands down to ${optimizedCommands.length} essential operations"`
                        );
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }

                    // Execute commands one by one
                    for (const command of optimizedCommands) {
                        console.log("Executing command:", command);
                        try {
                            await onExecuteCommand(command);
                            console.log("Command executed successfully:", command);
                            // Add a small delay between commands
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        } catch (error) {
                            console.error("Error executing command:", error);
                            // Continue with next command
                        }
                    }

                    console.log("Autonomous execution completed");
                } catch (err) {
                    console.error("Error in autonomous mode:", err);
                } finally {
                    setIsEnabled(false);
                    setIsRunning(false);
                }
            });
        }
    }, [isEnabled, isRunning, messageText, onExecuteCommand]);

    // Simple command extractor function
    function extractCommandsFromText(text: string): string[] {
        const commands: string[] = [];

        // Extract code blocks
        const codeBlockRegex = /```(?:bash|shell|sh)?\n([\s\S]*?)```/g;
        let match;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            const block = match[1].trim();
            if (block) {
                // Add each line as a command
                block
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line && !line.startsWith("#"))
                    .forEach((line) => {
                        // Remove $ prefix if present
                        if (line.startsWith("$ ")) {
                            line = line.substring(2);
                        }
                        commands.push(line);
                    });
            }
        }

        // If no commands found in code blocks, look for $ prefixed commands
        if (commands.length === 0) {
            const dollarRegex = /\$\s+([^\n]+)/g;
            while ((match = dollarRegex.exec(text)) !== null) {
                commands.push(match[1].trim());
            }
        }

        // If still no commands, look for lines that look like commands
        if (commands.length === 0) {
            const lines = text.split("\n");
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (
                    trimmedLine &&
                    !trimmedLine.startsWith("#") &&
                    !trimmedLine.includes("```") &&
                    !trimmedLine.includes("**") &&
                    /^(git|cd|ls|mkdir|rm|mv|cp|cat|echo|touch|find|grep|curl|wget|npm|yarn|python|node|go)/i.test(
                        trimmedLine
                    )
                ) {
                    commands.push(trimmedLine);
                }
            }
        }

        return commands;
    }

    // Command optimization function to remove redundant operations
    function optimizeCommands(commands: string[]): string[] {
        if (commands.length === 0) {
            return commands;
        }

        console.log("Original commands before optimization:", commands);

        // Special case for git workflow optimization
        const gitWorkflowOptimized = optimizeGitWorkflow(commands);
        if (gitWorkflowOptimized.length > 0) {
            console.log("Optimized git workflow detected, using optimized commands:", gitWorkflowOptimized);
            return gitWorkflowOptimized;
        }

        // Step 1: Remove exact duplicates
        const uniqueCommands = [...new Set(commands)];
        console.log("After removing duplicates:", uniqueCommands.length, "commands");

        // Step 2: Identify and remove redundant operations
        const optimizedCommands: string[] = [];
        const createdDirs = new Set<string>();
        const filesModified = new Set<string>();
        const skipReason = new Map<string, string>();

        // Keep track of current directory for cd commands
        let currentDir = "";

        for (const cmd of uniqueCommands) {
            let shouldAdd = true;

            // Handle mkdir commands - skip if directory already created
            if (cmd.startsWith("mkdir")) {
                const match = cmd.match(/mkdir\s+(?:-p\s+)?["']?([^"'\s]+)["']?/);
                if (match) {
                    const dir = match[1];
                    if (createdDirs.has(dir)) {
                        shouldAdd = false;
                        skipReason.set(cmd, `Directory '${dir}' already created`);
                    } else {
                        if (cmd.includes("-p")) {
                            // mkdir -p creates parent directories
                            const parts = dir.split("/");
                            let path = "";
                            for (const part of parts) {
                                path = path ? `${path}/${part}` : part;
                                createdDirs.add(path);
                            }
                        } else {
                            createdDirs.add(dir);
                        }
                    }
                }
            }

            // Handle cd commands - only keep the last cd to each directory
            else if (cmd.startsWith("cd ")) {
                const dirMatch = cmd.match(/cd\s+["']?([^"'\s]+)["']?/);
                if (dirMatch) {
                    const targetDir = dirMatch[1];

                    // Check if a later cd command goes to the same directory
                    const laterCdToSameDir = uniqueCommands.slice(uniqueCommands.indexOf(cmd) + 1).some((laterCmd) => {
                        const match = laterCmd.match(/cd\s+["']?([^"'\s]+)["']?/);
                        return match && match[1] === targetDir;
                    });

                    if (laterCdToSameDir) {
                        shouldAdd = false;
                        skipReason.set(cmd, `Later cd to '${targetDir}' exists`);
                    } else {
                        // Update current directory
                        if (targetDir.startsWith("/")) {
                            currentDir = targetDir;
                        } else if (targetDir === "..") {
                            const parts = currentDir.split("/");
                            parts.pop();
                            currentDir = parts.join("/");
                        } else {
                            currentDir = currentDir ? `${currentDir}/${targetDir}` : targetDir;
                        }
                    }
                }
            }

            // Handle file operations - skip redundant file creation
            else if (cmd.match(/^(touch|echo\s+.*>\s*|cat\s+.*>\s*)/)) {
                const fileMatch = cmd.match(/>+\s*["']?([^"'\s]+)["']?/);
                if (fileMatch) {
                    const filename = fileMatch[1];
                    if (filesModified.has(filename) && cmd.startsWith("touch")) {
                        // Skip touch if file already created/modified
                        shouldAdd = false;
                        skipReason.set(cmd, `File '${filename}' already touched or modified`);
                    } else {
                        filesModified.add(filename);
                    }
                } else if (cmd.startsWith("touch ")) {
                    // Handle simple touch command
                    const touchMatch = cmd.match(/touch\s+["']?([^"'\s]+)["']?/);
                    if (touchMatch) {
                        const filename = touchMatch[1];
                        if (filesModified.has(filename)) {
                            shouldAdd = false;
                            skipReason.set(cmd, `File '${filename}' already touched or modified`);
                        } else {
                            filesModified.add(filename);
                        }
                    }
                }
            }

            // Handle git commands - avoid redundant pulls/fetches
            else if (cmd.startsWith("git ")) {
                // Handle branch switching optimizations - for your specific case
                if (cmd.includes("checkout") || cmd.includes("switch")) {
                    // Extract the branch name
                    const branchMatch = cmd.match(/(?:checkout|switch)\s+([^\s]+)/);
                    if (branchMatch) {
                        const branchName = branchMatch[1];

                        // Check if there's a later command that also switches to a branch
                        const laterBranchSwitch = uniqueCommands
                            .slice(uniqueCommands.indexOf(cmd) + 1)
                            .some((laterCmd) => {
                                if (laterCmd.includes("checkout") || laterCmd.includes("switch")) {
                                    const laterBranchMatch = laterCmd.match(/(?:checkout|switch)\s+([^\s]+)/);
                                    return laterBranchMatch && laterBranchMatch[1] !== branchName;
                                }
                                return false;
                            });

                        // If we later switch to a different branch, we can skip this command
                        if (laterBranchSwitch) {
                            shouldAdd = false;
                            skipReason.set(cmd, `Later command switches to a different branch`);
                        }
                    }
                }

                // Group all pull commands by target
                // If we have multiple pulls to the same branch, just keep the last one
                else if (cmd.startsWith("git pull")) {
                    // Extract branch name if specified
                    const pullMatch = cmd.match(/git\s+pull\s+(?:origin\s+)?([^\s]*)/);
                    const pullTarget = pullMatch ? pullMatch[1] : "default";

                    // Look for later pulls to the same target
                    const laterPull = uniqueCommands.slice(uniqueCommands.indexOf(cmd) + 1).some((laterCmd) => {
                        if (laterCmd.startsWith("git pull")) {
                            const laterPullMatch = laterCmd.match(/git\s+pull\s+(?:origin\s+)?([^\s]*)/);
                            const laterPullTarget = laterPullMatch ? laterPullMatch[1] : "default";
                            return (
                                laterPullTarget === pullTarget ||
                                laterPullTarget === "default" ||
                                pullTarget === "default"
                            );
                        }
                        return false;
                    });

                    if (laterPull) {
                        shouldAdd = false;
                        skipReason.set(cmd, `Later git pull exists for the same target`);
                    }
                }

                // Special case for git workflows - if we're switching to a branch and then pulling
                // We can optimize by first checking if we're running both operations on the same branch
                if (shouldAdd && (cmd.includes("pull") || cmd.includes("fetch"))) {
                    // See if we just switched to a branch
                    const prevCommandIndex = uniqueCommands.indexOf(cmd) - 1;
                    if (prevCommandIndex >= 0) {
                        const prevCmd = uniqueCommands[prevCommandIndex];
                        if (prevCmd.includes("checkout") || prevCmd.includes("switch")) {
                            const branchMatch = prevCmd.match(/(?:checkout|switch)\s+([^\s]+)/);
                            const pullMatch = cmd.match(/pull\s+(?:origin\s+)?([^\s]*)/);

                            // If branch matches or pull is generic (no target specified)
                            if (branchMatch && (!pullMatch || branchMatch[1] === pullMatch[1])) {
                                console.log(`Detected branch switch+pull pattern: ${prevCmd} followed by ${cmd}`);
                                // We'll keep both commands in this case, but we could optimize further
                            }
                        }
                    }
                }
            }

            // Add command if it passed all filters
            if (shouldAdd) {
                optimizedCommands.push(cmd);
            } else {
                console.log(`Skipping redundant command: ${cmd} - Reason: ${skipReason.get(cmd)}`);
            }
        }

        console.log("Commands after optimization:", optimizedCommands);
        return optimizedCommands;
    }

    // Special function to detect and optimize git workflow patterns
    function optimizeGitWorkflow(commands: string[]): string[] {
        // Check for common git workflow patterns

        // Count git commands
        const gitCommands = commands.filter((cmd) => cmd.trim().startsWith("git "));
        if (gitCommands.length >= 2) {
            // Check for branch switching patterns
            const checkoutCommands = gitCommands.filter((cmd) => cmd.includes("checkout") || cmd.includes("switch"));
            const pullCommands = gitCommands.filter((cmd) => cmd.includes("pull") || cmd.includes("fetch"));

            // Detect "switch to branch and pull latest changes" pattern with any branch
            if (checkoutCommands.length > 0 && pullCommands.length > 0) {
                // Get last checkout command
                const lastCheckout = checkoutCommands[checkoutCommands.length - 1];
                const checkoutMatch = lastCheckout.match(/(?:checkout|switch)\s+([^\s]+)/);

                if (checkoutMatch) {
                    const branch = checkoutMatch[1];
                    console.log(`Optimizing git workflow for branch: ${branch}`);

                    // Determine the pull source - if pulling from a specific branch, use that,
                    // otherwise pull from the same branch we're checking out
                    const pullOriginMatch = pullCommands.find((cmd) => cmd.match(/pull\s+origin\s+([^\s]+)/));
                    let pullTarget = branch; // Default to pull from the same branch

                    if (pullOriginMatch) {
                        const pullMatch = pullOriginMatch.match(/pull\s+origin\s+([^\s]+)/);
                        if (pullMatch) {
                            pullTarget = pullMatch[1];
                        }
                    }

                    console.log(`Optimized git workflow: checkout ${branch}, pull from ${pullTarget}`);

                    // Return the optimized command sequence
                    return [`git checkout ${branch}`, `git pull origin ${pullTarget}`];
                }
            }
        }

        // If no special pattern detected, return empty array to continue with normal optimization
        return [];
    }

    return (
        <div className="autonomous-mode-toggle">
            <label className="toggle-container">
                <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={handleToggle}
                    disabled={isRunning} // Disable while running
                />
                <span className="toggle-label">
                    {isRunning ? "Running in autonomous mode..." : "Run in autonomous mode?"}
                </span>
            </label>
        </div>
    );
};

export default AutonomousModeToggle;
