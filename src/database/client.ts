import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// PrismaClient singleton
let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
        ...(process.env.LOG_LEVEL === 'debug'
          ? [{ level: 'query' as const, emit: 'event' as const }]
          : []),
      ],
    });

    // Log errors
    prisma.$on('error' as never, (e: { message: string }) => {
      logger.error('Prisma error', { error: e.message });
    });

    // Log warnings
    prisma.$on('warn' as never, (e: { message: string }) => {
      logger.warn('Prisma warning', { warning: e.message });
    });

    // Log queries in debug mode
    if (process.env.LOG_LEVEL === 'debug') {
      //prisma.$on('query' as never, (e: { query: string; duration: number }) => {
      //  logger.debug('Prisma query', { query: e.query, duration: e.duration });
      //});
    }
  }

  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Prisma disconnected');
  }
}

// Export default instance
export const db = getPrismaClient();
