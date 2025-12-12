import { MediaSourceType } from '@prisma/client';
import { createLogger } from '../utils/logger';
import { MediaMappingService } from './MediaMappingService';
import type { IShopwareClient } from '../clients/interfaces';

export interface UploadMediaResult {
  success: boolean;
  shopwareMediaId?: string;
  wasExisting: boolean;
  error?: string;
  mimeType?: string;
  fileSize?: number;
}

/**
 * Media Service
 * Orchestrates media uploads from source URLs to Shopware
 * - Checks if media already exists (by URL hash)
 * - Uploads new media to Shopware
 * - Stores mappings for deduplication
 */
export class MediaService {
  private log = createLogger({ service: 'MediaService' });
  private mappingService: MediaMappingService;
  private folderCache: Map<string, string> = new Map();

  constructor() {
    this.mappingService = new MediaMappingService();
  }

  /**
   * Upload media from URL to Shopware, with deduplication
   * If the URL was already uploaded, returns the existing media ID
   */
  async uploadFromUrl(
    tenantId: string,
    shopware: IShopwareClient,
    params: {
      sourceUrl: string;
      sourceType: MediaSourceType;
      sourceEntityId?: string;
      folderName?: string;
      fileName?: string;
      title?: string;
      alt?: string;
    }
  ): Promise<UploadMediaResult> {
    try {
      // Check if we already have this URL mapped
      const existingMapping = await this.mappingService.getMappingByUrl(tenantId, params.sourceUrl);

      if (existingMapping) {
        this.log.debug('Media already exists for URL', {
          sourceUrl: params.sourceUrl,
          shopwareMediaId: existingMapping.shopwareMediaId,
        });

        return {
          success: true,
          shopwareMediaId: existingMapping.shopwareMediaId,
          wasExisting: true,
        };
      }

      // Determine file name from URL if not provided
      let fileName = params.fileName;
      if (!fileName) {
        const urlPath = new URL(params.sourceUrl).pathname;
        fileName = urlPath.split('/').pop() || 'media';
        // Ensure it has an extension
        if (!fileName.includes('.')) {
          fileName += '.jpg';
        }
      }

      // Get or create the folder
      let folderId: string | undefined;
      if (params.folderName) {
        folderId = await this.getOrCreateFolder(shopware, params.folderName);
      }

      // Upload to Shopware
      const result = await shopware.createMediaFromUrl({
        sourceUrl: params.sourceUrl,
        fileName,
        folderId,
        title: params.title || fileName.replace(/\.[^/.]+$/, ''),
        alt: params.alt,
      });

      if (!result.success || !result.id) {
        return {
          success: false,
          wasExisting: false,
          error: result.error || 'Failed to upload media',
        };
      }

      // Store the mapping
      await this.mappingService.upsertMapping(tenantId, {
        sourceUrl: params.sourceUrl,
        sourceType: params.sourceType,
        sourceEntityId: params.sourceEntityId,
        shopwareMediaId: result.id,
        shopwareFolderId: folderId,
        fileName,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
        mappingType: 'AUTO',
        lastSyncAction: 'create',
      });

      this.log.info('Media uploaded successfully', {
        sourceUrl: params.sourceUrl,
        shopwareMediaId: result.id,
        fileName,
      });

      return {
        success: true,
        shopwareMediaId: result.id,
        wasExisting: false,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error('Failed to upload media from URL', {
        sourceUrl: params.sourceUrl,
        error: errorMessage,
      });

      return {
        success: false,
        wasExisting: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get existing media ID for a URL, if it was already uploaded
   */
  async getExistingMediaId(tenantId: string, sourceUrl: string): Promise<string | null> {
    const mapping = await this.mappingService.getMappingByUrl(tenantId, sourceUrl);
    return mapping?.shopwareMediaId || null;
  }

  /**
   * Batch check which URLs already have media uploaded
   * Returns a map of sourceUrl -> shopwareMediaId for existing uploads
   */
  async getExistingMediaIds(
    tenantId: string,
    sourceUrls: string[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    if (sourceUrls.length === 0) {
      return result;
    }

    const mappings = await this.mappingService.getBatchMappingsByUrls(tenantId, sourceUrls);

    // Convert hash-based lookup back to URL-based
    for (const sourceUrl of sourceUrls) {
      const hash = MediaMappingService.hashUrl(sourceUrl);
      const mapping = mappings[hash];
      if (mapping) {
        result.set(sourceUrl, mapping.shopwareMediaId);
      }
    }

    return result;
  }

  /**
   * Get or create a media folder (with caching)
   */
  private async getOrCreateFolder(shopware: IShopwareClient, folderName: string): Promise<string> {
    // Check cache first
    if (this.folderCache.has(folderName)) {
      return this.folderCache.get(folderName)!;
    }

    const folderId = await shopware.getOrCreateMediaFolder(folderName);
    this.folderCache.set(folderName, folderId);

    return folderId;
  }

  /**
   * Clear the folder cache (useful for testing or long-running processes)
   */
  clearFolderCache(): void {
    this.folderCache.clear();
  }
}
