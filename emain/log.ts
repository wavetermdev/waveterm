// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import path from "path";
import { format } from "util";
import winston from "winston";
import { getWaveDataDir, isDev } from "./platform";

const oldConsoleLog = console.log;

function findHighestLogNumber(logsDir: string): number {
    if (!fs.existsSync(logsDir)) {
        return 0;
    }
    const files = fs.readdirSync(logsDir);
    let maxNum = 0;
    for (const file of files) {
        const match = file.match(/^waveapp\.(\d+)\.log$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) {
                maxNum = num;
            }
        }
    }
    return maxNum;
}

function pruneOldLogs(logsDir: string) {
    if (!fs.existsSync(logsDir)) {
        return;
    }

    const files = fs.readdirSync(logsDir);
    const logFiles: { name: string; num: number }[] = [];

    for (const file of files) {
        const match = file.match(/^waveapp\.(\d+)\.log$/);
        if (match) {
            logFiles.push({ name: file, num: parseInt(match[1], 10) });
        }
    }

    if (logFiles.length <= 5) {
        return;
    }

    logFiles.sort((a, b) => b.num - a.num);
    const toDelete = logFiles.slice(5);

    for (const logFile of toDelete) {
        fs.unlinkSync(path.join(logsDir, logFile.name));
    }
}

function rotateLogIfNeeded() {
    const waveDataDir = getWaveDataDir();
    const logFile = path.join(waveDataDir, "waveapp.log");
    const logsDir = path.join(waveDataDir, "logs");

    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    if (!fs.existsSync(logFile)) {
        return;
    }

    const stats = fs.statSync(logFile);
    if (stats.size > 10 * 1024 * 1024) {
        const nextNum = findHighestLogNumber(logsDir) + 1;
        const rotatedPath = path.join(logsDir, `waveapp.${nextNum}.log`);
        fs.renameSync(logFile, rotatedPath);
    }
}

let logRotateError: any = null;
try {
    rotateLogIfNeeded();
    const logsDir = path.join(getWaveDataDir(), "logs");
    pruneOldLogs(logsDir);
} catch (e) {
    logRotateError = e;
}

const loggerTransports: winston.transport[] = [
    new winston.transports.File({ filename: path.join(getWaveDataDir(), "waveapp.log"), level: "info" }),
];
if (isDev) {
    loggerTransports.push(new winston.transports.Console());
}
const loggerConfig = {
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.printf((info) => `${info.timestamp} ${info.message}`)
    ),
    transports: loggerTransports,
};
const logger = winston.createLogger(loggerConfig);
if (logRotateError != null) {
    logger.error("error rotating/pruning logs (non-fatal):", logRotateError);
}
function log(...msg: any[]) {
    try {
        logger.info(format(...msg));
    } catch (e) {
        oldConsoleLog(...msg);
    }
}

export { log };
