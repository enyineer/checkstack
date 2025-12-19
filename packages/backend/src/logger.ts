import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize, json } = format;

const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const plugin = meta.plugin ? `[${meta.plugin}] ` : "";
  // Stringify rest of meta if it exists and isn't just plugin
  const { plugin: _p, ...rest } = meta;
  const metaStr = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";

  return `${timestamp} ${level}: ${plugin}${message} ${metaStr}`;
});

export const rootLogger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format:
    process.env.NODE_ENV === "production"
      ? json()
      : combine(colorize(), timestamp({ format: "HH:mm:ss" }), devFormat),
  transports: [new transports.Console()],
});
