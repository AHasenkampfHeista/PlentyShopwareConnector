import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';
const logToFile = process.env.LOG_TO_FILE === 'true';
const logFilePath = process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'connector.log');

// Ensure log directory exists
if (logToFile) {
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Create streams for multi-destination logging
const streams: pino.StreamEntry[] = [];

// Console stream with pretty printing (dev only)
if (!isProduction) {
  streams.push({
    level: logLevel as pino.Level,
    stream: pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false,
        hideObject: false,
        errorLikeObjectKeys: ['err', 'error'],
      },
    }),
  });
}

// File stream (JSON format for easy parsing)
if (logToFile) {
  streams.push({
    level: 'debug' as pino.Level, // Always log debug to file
    stream: fs.createWriteStream(logFilePath, { flags: 'a' }),
  });
  console.log(`Logging to file: ${logFilePath}`);
}

// Fallback to stdout if no streams configured
const transport = streams.length > 0 ? pino.multistream(streams) : undefined;

export const logger = transport
  ? pino(
      {
        level: 'debug', // Set to debug so file gets everything
        base: {
          service: process.env.SERVICE_NAME || 'connector',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      transport
    )
  : pino({
      level: logLevel,
      transport: isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
              singleLine: false,
              hideObject: false,
              errorLikeObjectKeys: ['err', 'error'],
            },
          },
      base: {
        service: process.env.SERVICE_NAME || 'connector',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });

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
