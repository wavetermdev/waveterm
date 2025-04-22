// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Autonomous Command Execution Module for WaveAI
 *
 * This module extracts and executes shell commands from AI responses.
 */

/**
 * Extract shell commands from an AI message text
 *
 * @param text The message text to extract commands from
 * @returns Array of command strings
 */
export function extractCommands(text: string): string[] {
    const commandsToExecute: string[] = [];
    console.log("Extracting commands from:", text.substring(0, 100) + "...");

    // Match shell code blocks
    const codeBlockRegex = /```(?:bash|shell|sh)?\n([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        const commandBlock = match[1].trim();
        console.log("Found code block:", commandBlock.substring(0, 50) + "...");
        if (commandBlock) {
            // Split by newlines and add each line as a separate command
            commandBlock
                .split("\n")
                .map((cmd) => cmd.trim())
                .filter((cmd) => cmd && !cmd.startsWith("#")) // Skip empty lines and comments
                .forEach((cmd) => {
                    // Remove $ prefix if it exists
                    if (cmd.startsWith("$ ")) {
                        cmd = cmd.substring(2);
                    }
                    commandsToExecute.push(cmd);
                });
        }
    }

    // Match $ prefixed commands outside code blocks
    const commandRegex = /\$\s+([^\n]+)/g;
    while ((match = commandRegex.exec(text)) !== null) {
        commandsToExecute.push(match[1].trim());
    }

    // If no commands found, look for any lines that might be commands
    if (commandsToExecute.length === 0) {
        const lines = text.split("\n");
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Check if this looks like a command (no markup, starts with common command prefixes)
            if (
                trimmedLine &&
                !trimmedLine.startsWith("#") &&
                !trimmedLine.includes("```") &&
                !trimmedLine.includes("**") &&
                (/^(git|cd|ls|mkdir|rm|mv|cp|cat|echo|touch|find|grep|curl|wget|npm|yarn|python|node|go)/i.test(
                    trimmedLine
                ) ||
                    /^(docker|kubectl|terraform|aws|az|gcloud)/i.test(trimmedLine))
            ) {
                commandsToExecute.push(trimmedLine);
            }
        }
    }

    console.log("Extracted commands:", commandsToExecute);
    return commandsToExecute;
}

/**
 * Execute commands sequentially with a terminal executor function
 *
 * @param commands Array of commands to execute
 * @param executor Function that executes a single command
 * @param delay Delay between commands in milliseconds
 * @returns Promise that resolves when all commands are executed
 */
export async function executeCommands(
    commands: string[],
    executor: (cmd: string) => Promise<void>,
    delay: number = 1000
): Promise<void> {
    if (commands.length === 0) {
        console.warn("No commands to execute");
        return;
    }

    console.log("Executing commands:", commands);

    // Execute each command sequentially
    for (const command of commands) {
        try {
            console.log("Executing command:", command);
            await executor(command);
            // Wait between commands
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        } catch (error) {
            console.error(`Error executing command "${command}":`, error);
            throw error; // Re-throw to allow caller to handle
        }
    }
}
