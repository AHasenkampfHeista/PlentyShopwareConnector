import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV !== 'production';
const logToFile = process.env.LOG_TO_FILE === 'true';
const logFilePath = process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'connector.log');

// Ensure log directory exists
if (logToFile) {
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  console.log(`Logging to file: ${logFilePath}`);
}

// Simple file stream for logging
const fileStream = logToFile ? fs.createWriteStream(logFilePath, { flags: 'a' }) : null;

// Create base logger config
const baseConfig: pino.LoggerOptions = {
  level: logLevel,
  base: {
    service: process.env.SERVICE_NAME || 'plenty-connector',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Create the logger based on environment
let logger: pino.Logger;

if (logToFile && fileStream) {
  // Log to file as JSON
  logger = pino(baseConfig, fileStream);
} else if (isDevelopment) {
  // Pretty print to console in development
  logger = pino({
    ...baseConfig,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  });
} else {
  // Plain JSON to stdout for production/Loki
  logger = pino(baseConfig);
}

export { logger };
export type Logger = typeof logger;

// Create a child logger with additional context
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

// Create a tenant-scoped logger
export function createTenantLogger(tenantId: string) {
  return logger.child({ tenantId });
}

// Create a job-scoped logger
export function createJobLogger(jobId: string, tenantId: string, syncType: string) {
  return logger.child({ jobId, tenantId, syncType });
}
