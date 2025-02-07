// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import path from "path";
import { format } from "util";
import winston from "winston";
import { getWaveDataDir, isDev } from "./platform";

const oldConsoleLog = console.log;

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
function log(...msg: any[]) {
    try {
        logger.info(format(...msg));
    } catch (e) {
        oldConsoleLog(...msg);
    }
}

export { log };
