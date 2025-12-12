import { PrismaClient, MappingType, MediaSourceType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import crypto from 'crypto';

export interface MediaMappingRecord {
  sourceUrl: string;
  sourceType: MediaSourceType;
  sourceEntityId?: string;
  shopwareMediaId: string;
  shopwareFolderId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface MediaMappingLookup {
  [sourceUrlHash: string]: {
    shopwareMediaId: string;
    shopwareFolderId?: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Media Mapping Service
 * Manages the mapping between source URLs (e.g., from PlentyMarkets) and Shopware media IDs
 */
export class MediaMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'MediaMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Generate a hash for a URL (for faster lookups and deduplication)
   */
  static hashUrl(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  /**
   * Get mapping by source URL
   */
  async getMappingByUrl(
    tenantId: string,
    sourceUrl: string
  ): Promise<{ shopwareMediaId: string; shopwareFolderId?: string; mappingType: string } | null> {
    const urlHash = MediaMappingService.hashUrl(sourceUrl);

    const mapping = await this.prisma.mediaMapping.findUnique({
      where: {
        tenantId_sourceUrlHash: {
          tenantId,
          sourceUrlHash: urlHash,
        },
      },
      select: {
        shopwareMediaId: true,
        shopwareFolderId: true,
        mappingType: true,
      },
    });

    if (!mapping) return null;

    return {
      shopwareMediaId: mapping.shopwareMediaId,
      shopwareFolderId: mapping.shopwareFolderId || undefined,
      mappingType: mapping.mappingType,
    };
  }

  /**
   * Get mapping by Shopware media ID
   */
  async getMappingByMediaId(
    tenantId: string,
    shopwareMediaId: string
  ): Promise<{ sourceUrl: string; sourceType: MediaSourceType; mappingType: string } | null> {
    const mapping = await this.prisma.mediaMapping.findUnique({
      where: {
        tenantId_shopwareMediaId: {
          tenantId,
          shopwareMediaId,
        },
      },
      select: {
        sourceUrl: true,
        sourceType: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Get batch mappings for multiple URLs
   */
  async getBatchMappingsByUrls(
    tenantId: string,
    sourceUrls: string[]
  ): Promise<MediaMappingLookup> {
    if (sourceUrls.length === 0) {
      return {};
    }

    const urlHashes = sourceUrls.map((url) => MediaMappingService.hashUrl(url));

    const mappings = await this.prisma.mediaMapping.findMany({
      where: {
        tenantId,
        sourceUrlHash: {
          in: urlHashes,
        },
      },
      select: {
        sourceUrlHash: true,
        shopwareMediaId: true,
        shopwareFolderId: true,
        mappingType: true,
      },
    });

    const lookup: MediaMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.sourceUrlHash] = {
        shopwareMediaId: mapping.shopwareMediaId,
        shopwareFolderId: mapping.shopwareFolderId || undefined,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch media mappings', {
      tenantId,
      requested: sourceUrls.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert a single mapping
   */
  async upsertMapping(tenantId: string, record: MediaMappingRecord): Promise<void> {
    const urlHash = MediaMappingService.hashUrl(record.sourceUrl);

    await this.prisma.mediaMapping.upsert({
      where: {
        tenantId_sourceUrlHash: {
          tenantId,
          sourceUrlHash: urlHash,
        },
      },
      create: {
        tenantId,
        sourceUrl: record.sourceUrl,
        sourceUrlHash: urlHash,
        sourceType: record.sourceType,
        sourceEntityId: record.sourceEntityId,
        shopwareMediaId: record.shopwareMediaId,
        shopwareFolderId: record.shopwareFolderId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        fileSize: record.fileSize,
        mappingType: record.mappingType,
        lastSyncedAt: new Date(),
        lastSyncAction: record.lastSyncAction,
      },
      update: {
        sourceType: record.sourceType,
        sourceEntityId: record.sourceEntityId,
        shopwareMediaId: record.shopwareMediaId,
        shopwareFolderId: record.shopwareFolderId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        fileSize: record.fileSize,
        mappingType: record.mappingType,
        lastSyncedAt: new Date(),
        lastSyncAction: record.lastSyncAction,
      },
    });

    this.log.debug('Media mapping upserted', {
      tenantId,
      sourceUrl: record.sourceUrl,
      shopwareMediaId: record.shopwareMediaId,
    });
  }

  /**
   * Upsert multiple mappings at once (transaction)
   */
  async upsertMappings(tenantId: string, records: MediaMappingRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting media mappings', { tenantId, count: records.length });

    await this.prisma.$transaction(
      records.map((record) => {
        const urlHash = MediaMappingService.hashUrl(record.sourceUrl);

        return this.prisma.mediaMapping.upsert({
          where: {
            tenantId_sourceUrlHash: {
              tenantId,
              sourceUrlHash: urlHash,
            },
          },
          create: {
            tenantId,
            sourceUrl: record.sourceUrl,
            sourceUrlHash: urlHash,
            sourceType: record.sourceType,
            sourceEntityId: record.sourceEntityId,
            shopwareMediaId: record.shopwareMediaId,
            shopwareFolderId: record.shopwareFolderId,
            fileName: record.fileName,
            mimeType: record.mimeType,
            fileSize: record.fileSize,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            sourceType: record.sourceType,
            sourceEntityId: record.sourceEntityId,
            shopwareMediaId: record.shopwareMediaId,
            shopwareFolderId: record.shopwareFolderId,
            fileName: record.fileName,
            mimeType: record.mimeType,
            fileSize: record.fileSize,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        });
      })
    );

    this.log.info('Media mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Delete mapping by source URL
   */
  async deleteMappingByUrl(tenantId: string, sourceUrl: string): Promise<boolean> {
    const urlHash = MediaMappingService.hashUrl(sourceUrl);

    try {
      await this.prisma.mediaMapping.delete({
        where: {
          tenantId_sourceUrlHash: {
            tenantId,
            sourceUrlHash: urlHash,
          },
        },
      });

      this.log.info('Media mapping deleted', { tenantId, sourceUrl });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get count of mappings for a tenant
   */
  async getMappingCount(tenantId: string): Promise<number> {
    return this.prisma.mediaMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get mappings by source type
   */
  async getMappingsBySourceType(
    tenantId: string,
    sourceType: MediaSourceType
  ): Promise<MediaMappingRecord[]> {
    const mappings = await this.prisma.mediaMapping.findMany({
      where: {
        tenantId,
        sourceType,
      },
      select: {
        sourceUrl: true,
        sourceType: true,
        sourceEntityId: true,
        shopwareMediaId: true,
        shopwareFolderId: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      sourceUrl: m.sourceUrl,
      sourceType: m.sourceType,
      sourceEntityId: m.sourceEntityId || undefined,
      shopwareMediaId: m.shopwareMediaId,
      shopwareFolderId: m.shopwareFolderId || undefined,
      fileName: m.fileName || undefined,
      mimeType: m.mimeType || undefined,
      fileSize: m.fileSize || undefined,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }
}
