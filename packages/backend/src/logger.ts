import { createLogger, format, transports } from "winston";
import path from "node:path";
import fs from "node:fs";

const { combine, timestamp, printf, colorize, json } = format;

const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const plugin = meta.plugin ? `[${meta.plugin}] ` : "";
  // Stringify rest of meta if it exists and isn't just plugin
  const { plugin: _p, ...rest } = meta;
  const metaStr = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";

  return `${timestamp} ${level}: ${plugin}${message} ${metaStr}`;
});

// Plain text format for file logging (without colors)
const fileFormat = printf(({ level, message, timestamp, ...meta }) => {
  const plugin = meta.plugin ? `[${meta.plugin}] ` : "";
  const { plugin: _p, ...rest } = meta;
  const metaStr = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";

  return `${timestamp} ${level}: ${plugin}${message} ${metaStr}`;
});

// Setup file transports for development
const developmentTransports: transports.StreamTransportInstance[] = [
  new transports.Console(),
];

if (process.env.NODE_ENV !== "production") {
  // Create logs directory if it doesn't exist
  const logsDir = path.join(process.cwd(), ".dev", "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Add file transports
  developmentTransports.push(
    // Timestamped log file
    new transports.File({
      filename: path.join(
        logsDir,
        `backend-${
          new Date().toISOString().replaceAll(":", "-").split(".")[0]
        }.log`
      ),
      format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), fileFormat),
    }),
    // Latest log file (always overwritten)
    new transports.File({
      filename: path.join(logsDir, "latest.log"),
      format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), fileFormat),
      options: { flags: "w" }, // Overwrite on each start
    })
  );
}

export const rootLogger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format:
    process.env.NODE_ENV === "production"
      ? json()
      : combine(colorize(), timestamp({ format: "HH:mm:ss" }), devFormat),
  transports: developmentTransports,
});
