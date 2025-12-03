import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: logLevel,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
  base: {
    service: process.env.SERVICE_NAME || 'connector',
  },
  formatters: {
    level: (label) => ({ level: label }),
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
