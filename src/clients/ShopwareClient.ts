import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import { IShopwareClient, ShopwareClientConfig } from './interfaces';
import {
  ShopwareProduct,
  ShopwareStockUpdate,
  ShopwareSyncResult,
  ShopwareBulkProduct,
  ShopwareBulkSyncResult,
  ShopwareBulkItemResult,
  ShopwareCategory,
  ShopwarePropertyGroup,
  ShopwarePropertyOption,
  ShopwareManufacturer,
  ShopwareUnit,
  ShopwareAuthResponse,
} from '../types/shopware';

/**
 * Real Shopware 6 API Client
 * Connects to actual Shopware instance via Admin API
 */
export class ShopwareClient implements IShopwareClient {
  private http: AxiosInstance;
  private config: ShopwareClientConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private log = createLogger({ client: 'ShopwareClient' });

  constructor(config: ShopwareClientConfig) {
    this.config = config;
    this.log = createLogger({ client: 'ShopwareClient', baseUrl: config.baseUrl });

    // Create axios instance with base configuration
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Add request interceptor to inject auth token
    this.http.interceptors.request.use(async (reqConfig) => {
      // Skip auth header for token endpoint
      if (reqConfig.url?.includes('/oauth/token')) {
        return reqConfig;
      }

      // Ensure we have a valid token
      await this.ensureAuthenticated();

      if (this.accessToken) {
        reqConfig.headers.Authorization = `Bearer ${this.accessToken}`;
      }

      return reqConfig;
    });

    // Add response interceptor for error handling
    this.http.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config;

        // Don't retry auth endpoint or already retried requests
        if (originalRequest?.url?.includes('/oauth/token')) {
          throw error;
        }

        if (error.response?.status === 401) {
          // Token expired, clear it and retry once
          this.accessToken = null;
          this.tokenExpiresAt = null;

          if (originalRequest && !originalRequest.headers['X-Retry']) {
            originalRequest.headers['X-Retry'] = 'true';
            await this.authenticate();
            return this.http(originalRequest);
          }
        }
        throw error;
      }
    );
  }

  /**
   * Authenticate with Shopware Admin API using OAuth2 client credentials
   */
  async authenticate(): Promise<void> {
    this.log.info('Authenticating with Shopware Admin API');

    try {
      // Shopware 6 Admin API uses JSON for OAuth token requests
      const response = await this.http.post<ShopwareAuthResponse>('/api/oauth/token', {
        grant_type: 'client_credentials',
        client_id: this.config.credentials.clientId,
        client_secret: this.config.credentials.clientSecret,
      });

      this.accessToken = response.data.access_token;
      // Set expiry slightly before actual expiry to account for clock drift
      this.tokenExpiresAt = new Date(Date.now() + (response.data.expires_in - 60) * 1000);

      this.log.info('Authentication successful', { expiresIn: response.data.expires_in });
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      // Log more details for debugging
      if (error instanceof AxiosError) {
        this.log.error('Authentication failed', {
          error: errorMessage,
          status: error.response?.status,
          responseData: JSON.stringify(error.response?.data),
          url: error.config?.url,
        });
      } else {
        this.log.error('Authentication failed', { error: errorMessage });
      }
      throw new Error(`Shopware authentication failed: ${errorMessage}`);
    }
  }

  /**
   * Ensure we have a valid authentication token
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || !this.tokenExpiresAt || this.tokenExpiresAt <= new Date()) {
      await this.authenticate();
    }
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    return !!(this.accessToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date());
  }

  // ============================================
  // MEDIA METHODS
  // ============================================

  /**
   * Create a media entity in Shopware (without uploading file yet)
   */
  async createMedia(params: {
    fileName: string;
    folderId?: string;
    title?: string;
    alt?: string;
  }): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating media entity', { fileName: params.fileName });

      const payload: Record<string, unknown> = {};
      if (params.folderId) payload.mediaFolderId = params.folderId;
      if (params.title) payload.title = params.title;
      if (params.alt) payload.alt = params.alt;

      const response = await this.http.post('/api/media', payload);

      const createdId = response.data?.data?.id || response.data?.id || response.headers?.location?.split('/').pop();

      this.log.info('Media entity created', { fileName: params.fileName, id: createdId });

      return {
        id: createdId || '',
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create media entity', { fileName: params.fileName, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Upload media file from URL to an existing media entity
   */
  async uploadMediaFromUrl(mediaId: string, sourceUrl: string, fileName: string): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Uploading media from URL', { mediaId, sourceUrl, fileName });

      // Download the file from the source URL
      const imageResponse = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const fileBuffer = Buffer.from(imageResponse.data);
      const contentType = imageResponse.headers['content-type'] || 'application/octet-stream';

      // Extract file extension from filename or content type
      let extension = fileName.split('.').pop()?.toLowerCase() || '';
      if (!extension) {
        const mimeToExt: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/svg+xml': 'svg',
        };
        extension = mimeToExt[contentType] || 'jpg';
      }

      // Upload to Shopware using the _action/media/{mediaId}/upload endpoint
      await this.http.post(
        `/api/_action/media/${mediaId}/upload`,
        fileBuffer,
        {
          params: {
            extension,
            fileName: fileName.replace(/\.[^/.]+$/, ''), // Remove extension from fileName param
          },
          headers: {
            'Content-Type': contentType,
          },
        }
      );

      this.log.info('Media uploaded successfully', { mediaId, fileName });

      return {
        id: mediaId,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to upload media from URL', { mediaId, sourceUrl, error: errorMessage });

      return {
        id: mediaId,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Create media and upload from URL in one operation
   */
  async createMediaFromUrl(params: {
    sourceUrl: string;
    fileName: string;
    folderId?: string;
    title?: string;
    alt?: string;
  }): Promise<ShopwareSyncResult & { mimeType?: string; fileSize?: number }> {
    try {
      this.log.info('Creating media from URL', { sourceUrl: params.sourceUrl, fileName: params.fileName });

      // First, download the file to get metadata
      const imageResponse = await axios.get(params.sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const fileBuffer = Buffer.from(imageResponse.data);
      const contentType = imageResponse.headers['content-type'] || 'application/octet-stream';
      const fileSize = fileBuffer.length;

      // Extract file extension
      let extension = params.fileName.split('.').pop()?.toLowerCase() || '';
      if (!extension) {
        const mimeToExt: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/svg+xml': 'svg',
        };
        extension = mimeToExt[contentType] || 'jpg';
      }

      // Create the media entity
      const createPayload: Record<string, unknown> = {};
      if (params.folderId) createPayload.mediaFolderId = params.folderId;
      if (params.title) createPayload.title = params.title;
      if (params.alt) createPayload.alt = params.alt;

      const createResponse = await this.http.post('/api/media', createPayload);
      const mediaId = createResponse.data?.data?.id || createResponse.data?.id || createResponse.headers?.location?.split('/').pop();

      if (!mediaId) {
        throw new Error('Failed to get media ID from create response');
      }

      // Upload the file to the media entity
      const fileNameWithoutExt = params.fileName.replace(/\.[^/.]+$/, '');
      await this.http.post(
        `/api/_action/media/${mediaId}/upload`,
        fileBuffer,
        {
          params: {
            extension,
            fileName: fileNameWithoutExt,
          },
          headers: {
            'Content-Type': contentType,
          },
        }
      );

      this.log.info('Media created and uploaded successfully', { mediaId, fileName: params.fileName });

      return {
        id: mediaId,
        productNumber: '',
        action: 'create',
        success: true,
        mimeType: contentType,
        fileSize,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create media from URL', { sourceUrl: params.sourceUrl, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get media by ID
   */
  async getMediaById(id: string): Promise<{ id: string; fileName: string; mimeType: string; fileSize: number } | null> {
    try {
      const response = await this.http.get(`/api/media/${id}`);
      const data = response.data?.data || response.data;

      if (!data) return null;

      return {
        id: data.id,
        fileName: data.fileName || '',
        mimeType: data.mimeType || '',
        fileSize: data.fileSize || 0,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if media exists by ID
   */
  async mediaExists(id: string): Promise<boolean> {
    try {
      await this.http.get(`/api/media/${id}`);
      return true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get or create a media folder by name
   */
  async getOrCreateMediaFolder(folderName: string): Promise<string> {
    try {
      // First, try to find existing folder
      const searchResponse = await this.http.post('/api/search/media-folder', {
        filter: [
          {
            type: 'equals',
            field: 'name',
            value: folderName,
          },
        ],
        limit: 1,
      });

      const existingFolder = searchResponse.data?.data?.[0];
      if (existingFolder) {
        this.log.debug('Found existing media folder', { folderName, folderId: existingFolder.id });
        return existingFolder.id;
      }

      // Generate IDs for folder and configuration
      const folderId = this.generateUuid();
      const configurationId = this.generateUuid();

      // Create new folder with its own configuration
      // Shopware requires a configuration object for media folders
      const createResponse = await this.http.post('/api/media-folder', {
        id: folderId,
        name: folderName,
        configuration: {
          id: configurationId,
          createThumbnails: true,
          keepAspectRatio: true,
          thumbnailQuality: 80,
        },
      });

      const createdFolderId = createResponse.data?.data?.id || createResponse.data?.id || createResponse.headers?.location?.split('/').pop() || folderId;

      this.log.info('Created new media folder', { folderName, folderId: createdFolderId });
      return createdFolderId;
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to get or create media folder', { folderName, error: errorMessage });
      throw new Error(`Failed to get or create media folder: ${errorMessage}`);
    }
  }

  /**
   * Test connection to Shopware API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      // Test with a simple API call
      await this.http.get('/api/_info/version');
      return true;
    } catch (error) {
      this.log.error('Connection test failed', { error: this.extractErrorMessage(error) });
      return false;
    }
  }

  // ============================================
  // PRODUCT METHODS
  // ============================================

  /**
   * Create a new product
   */
  async createProduct(product: ShopwareProduct): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Creating product', { sku: product.productNumber });

      const payload = this.buildProductPayload(product);
      const response = await this.http.post('/api/product', payload);

      // Shopware returns the ID in the response or we can extract from headers
      const productId = response.headers['location']?.split('/').pop() || product.id || '';

      this.log.info('Product created', { id: productId, sku: product.productNumber });

      return {
        id: productId,
        productNumber: product.productNumber,
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create product', { sku: product.productNumber, error: errorMessage });

      return {
        id: '',
        productNumber: product.productNumber,
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing product by ID
   */
  async updateProduct(id: string, product: Partial<ShopwareProduct>): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Updating product by ID', { id });

      const payload = this.buildProductPayload(product);
      await this.http.patch(`/api/product/${id}`, payload);

      this.log.info('Product updated', { id, sku: product.productNumber });

      return {
        id,
        productNumber: product.productNumber || '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update product', { id, error: errorMessage });

      return {
        id,
        productNumber: product.productNumber || '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing product by SKU
   */
  async updateProductBySku(sku: string, product: Partial<ShopwareProduct>): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Updating product by SKU', { sku });

      // First find the product by SKU
      const existing = await this.getProductBySku(sku);
      if (!existing || !existing.id) {
        return {
          id: '',
          productNumber: sku,
          action: 'error',
          success: false,
          error: 'Product not found',
        };
      }

      return this.updateProduct(existing.id, product);
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update product by SKU', { sku, error: errorMessage });

      return {
        id: '',
        productNumber: sku,
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get product by SKU (productNumber)
   */
  async getProductBySku(sku: string): Promise<ShopwareProduct | null> {
    try {
      const response = await this.http.post('/api/search/product', {
        filter: [
          {
            type: 'equals',
            field: 'productNumber',
            value: sku,
          },
        ],
        limit: 1,
      });

      if (response.data.data && response.data.data.length > 0) {
        return this.mapApiResponseToProduct(response.data.data[0]);
      }

      return null;
    } catch (error) {
      this.log.error('Failed to get product by SKU', { sku, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if product exists by SKU
   */
  async productExists(sku: string): Promise<boolean> {
    const product = await this.getProductBySku(sku);
    return product !== null;
  }

  /**
   * Bulk sync products using Shopware's sync API
   */
  async bulkSyncProducts(products: ShopwareBulkProduct[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Bulk syncing products', { count: products.length });

    const results: ShopwareBulkItemResult[] = [];

    // Use Shopware's _action/sync endpoint for bulk operations
    const upsertPayload = products.map((product) => ({
      ...this.buildProductPayload(product),
      id: product.id || this.generateUuid(),
    }));

    try {
      // Use sync API for upsert operations
      const response = await this.http.post('/api/_action/sync', {
        'upsert-product': {
          entity: 'product',
          action: 'upsert',
          payload: upsertPayload,
        },
      });

      // Process results
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const payload = upsertPayload[i];

        // Check if there's an error for this specific item
        const hasError = response.data?.errors?.['upsert-product']?.[i];

        if (hasError) {
          results.push({
            productNumber: product.productNumber,
            shopwareId: payload.id,
            action: product.id ? 'update' : 'create',
            success: false,
            error: JSON.stringify(hasError),
          });
        } else {
          results.push({
            productNumber: product.productNumber,
            shopwareId: payload.id,
            action: product.id ? 'update' : 'create',
            success: true,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      this.log.info('Bulk sync completed', { total: products.length, success: successCount, failed: failCount });

      return {
        success: failCount === 0,
        results,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Bulk sync failed', { error: errorMessage });

      // Return all as failed
      return {
        success: false,
        results: products.map((product) => ({
          productNumber: product.productNumber,
          shopwareId: product.id || '',
          action: product.id ? 'update' : 'create',
          success: false,
          error: errorMessage,
        })),
      };
    }
  }

  /**
   * Update stock for a product by SKU
   */
  async updateStock(sku: string, stock: number): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Updating stock by SKU', { sku, stock });

      const product = await this.getProductBySku(sku);
      if (!product || !product.id) {
        return {
          id: '',
          productNumber: sku,
          action: 'skip',
          success: false,
          error: 'Product not found',
        };
      }

      await this.http.patch(`/api/product/${product.id}`, { stock });

      this.log.info('Stock updated', { id: product.id, sku, stock });

      return {
        id: product.id,
        productNumber: sku,
        action: 'update',
        success: true,
        details: { stock },
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update stock', { sku, error: errorMessage });

      return {
        id: '',
        productNumber: sku,
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Batch update stock for multiple products
   */
  async batchUpdateStock(updates: ShopwareStockUpdate[]): Promise<ShopwareSyncResult[]> {
    this.log.info('Batch updating stock', { count: updates.length });

    // Use sync API for batch stock updates
    try {
      const payload = updates.map((update) => ({
        id: update.id,
        stock: update.stock,
      }));

      await this.http.post('/api/_action/sync', {
        'update-stock': {
          entity: 'product',
          action: 'upsert',
          payload,
        },
      });

      return updates.map((update) => ({
        id: update.id,
        productNumber: update.productNumber || '',
        action: 'update' as const,
        success: true,
        details: { stock: update.stock },
      }));
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Batch stock update failed', { error: errorMessage });

      return updates.map((update) => ({
        id: update.id,
        productNumber: update.productNumber || '',
        action: 'error' as const,
        success: false,
        error: errorMessage,
      }));
    }
  }

  // ============================================
  // CATEGORY METHODS
  // ============================================

  /**
   * Create a new category
   */
  async createCategory(category: ShopwareCategory): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating category', { name: category.name });

      const payload = this.buildCategoryPayload(category);
      const response = await this.http.post('/api/category', payload);

      // Extract created ID from response
      const createdId = response.data?.data?.id || response.data?.id || response.headers?.location?.split('/').pop();

      this.log.info('Category created', { name: category.name, id: createdId });

      return {
        id: createdId || '',
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create category', { name: category.name, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing category by ID
   */
  async updateCategory(id: string, category: Partial<ShopwareCategory>): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Updating category', { id });

      const payload = this.buildCategoryPayload(category);
      await this.http.patch(`/api/category/${id}`, payload);

      return {
        id,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update category', { id, error: errorMessage });

      return {
        id,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get category by ID
   */
  async getCategoryById(id: string): Promise<ShopwareCategory | null> {
    try {
      const response = await this.http.get(`/api/category/${id}`);
      return this.mapApiResponseToCategory(response.data.data);
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.log.error('Failed to get category', { id, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if category exists by ID
   */
  async categoryExists(id: string): Promise<boolean> {
    const category = await this.getCategoryById(id);
    return category !== null;
  }

  /**
   * Bulk sync categories
   */
  async bulkSyncCategories(categories: ShopwareCategory[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Bulk syncing categories', { count: categories.length });

    try {
      const payload = categories.map((cat) => this.buildCategoryPayload(cat));

      await this.http.post('/api/_action/sync', {
        'upsert-category': {
          entity: 'category',
          action: 'upsert',
          payload,
        },
      });

      return {
        success: true,
        results: categories.map((cat) => ({
          productNumber: '',
          shopwareId: cat.id,
          action: 'create' as const,
          success: true,
        })),
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Bulk category sync failed', { error: errorMessage });

      return {
        success: false,
        results: categories.map((cat) => ({
          productNumber: '',
          shopwareId: cat.id,
          action: 'create' as const,
          success: false,
          error: errorMessage,
        })),
      };
    }
  }

  // ============================================
  // PROPERTY GROUP METHODS
  // ============================================

  /**
   * Create a property group
   */
  async createPropertyGroup(group: ShopwarePropertyGroup): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating property group', { name: group.name });

      const payload = this.buildPropertyGroupPayload(group);
      const response = await this.http.post('/api/property-group', payload);

      // Extract created ID from response
      const createdId = response.data?.data?.id || response.data?.id || response.headers?.location?.split('/').pop();

      this.log.info('Property group created', { name: group.name, id: createdId });

      return {
        id: createdId || '',
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create property group', { name: group.name, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update a property group by ID
   */
  async updatePropertyGroup(id: string, group: Partial<ShopwarePropertyGroup>): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Updating property group', { id });

      const payload = this.buildPropertyGroupPayload(group);
      await this.http.patch(`/api/property-group/${id}`, payload);

      return {
        id,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update property group', { id, error: errorMessage });

      return {
        id,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get property group by ID
   */
  async getPropertyGroupById(id: string): Promise<ShopwarePropertyGroup | null> {
    try {
      const response = await this.http.get(`/api/property-group/${id}`);
      return this.mapApiResponseToPropertyGroup(response.data.data);
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.log.error('Failed to get property group', { id, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if property group exists
   */
  async propertyGroupExists(id: string): Promise<boolean> {
    const group = await this.getPropertyGroupById(id);
    return group !== null;
  }

  /**
   * Bulk sync property groups
   */
  async bulkSyncPropertyGroups(groups: ShopwarePropertyGroup[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Bulk syncing property groups', { count: groups.length });

    try {
      const payload = groups.map((g) => this.buildPropertyGroupPayload(g));

      await this.http.post('/api/_action/sync', {
        'upsert-property-group': {
          entity: 'property_group',
          action: 'upsert',
          payload,
        },
      });

      return {
        success: true,
        results: groups.map((g) => ({
          productNumber: '',
          shopwareId: g.id,
          action: 'create' as const,
          success: true,
        })),
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Bulk property group sync failed', { error: errorMessage });

      return {
        success: false,
        results: groups.map((g) => ({
          productNumber: '',
          shopwareId: g.id,
          action: 'create' as const,
          success: false,
          error: errorMessage,
        })),
      };
    }
  }

  // ============================================
  // PROPERTY OPTION METHODS
  // ============================================

  /**
   * Create a property option
   */
  async createPropertyOption(option: ShopwarePropertyOption): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating property option', { name: option.name, groupId: option.groupId });

      const payload = this.buildPropertyOptionPayload(option);
      const response = await this.http.post('/api/property-group-option', payload);

      // Extract created ID from response
      const createdId = response.data?.data?.id || response.data?.id || response.headers?.location?.split('/').pop();

      this.log.info('Property option created', { name: option.name, id: createdId });

      return {
        id: createdId || '',
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create property option', { name: option.name, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update a property option by ID
   */
  async updatePropertyOption(id: string, option: Partial<ShopwarePropertyOption>): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Updating property option', { id });

      const payload = this.buildPropertyOptionPayload(option);
      await this.http.patch(`/api/property-group-option/${id}`, payload);

      return {
        id,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update property option', { id, error: errorMessage });

      return {
        id,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get property option by ID
   */
  async getPropertyOptionById(id: string): Promise<ShopwarePropertyOption | null> {
    try {
      const response = await this.http.get(`/api/property-group-option/${id}`);
      return this.mapApiResponseToPropertyOption(response.data.data);
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.log.error('Failed to get property option', { id, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if property option exists
   */
  async propertyOptionExists(id: string): Promise<boolean> {
    const option = await this.getPropertyOptionById(id);
    return option !== null;
  }

  /**
   * Bulk sync property options
   */
  async bulkSyncPropertyOptions(options: ShopwarePropertyOption[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Bulk syncing property options', { count: options.length });

    try {
      const payload = options.map((o) => this.buildPropertyOptionPayload(o));

      await this.http.post('/api/_action/sync', {
        'upsert-property-option': {
          entity: 'property_group_option',
          action: 'upsert',
          payload,
        },
      });

      return {
        success: true,
        results: options.map((o) => ({
          productNumber: '',
          shopwareId: o.id,
          action: 'create' as const,
          success: true,
        })),
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Bulk property option sync failed', { error: errorMessage });

      return {
        success: false,
        results: options.map((o) => ({
          productNumber: '',
          shopwareId: o.id,
          action: 'create' as const,
          success: false,
          error: errorMessage,
        })),
      };
    }
  }

  // ============================================
  // PRICE METHODS
  // ============================================

  /**
   * Create a price (rule)
   * Note: Shopware uses price rules, not separate price entities
   */
  async createPrice(price: {
    name: string;
    type?: string;
    isGross?: boolean;
    plentySalesPriceId?: number;
    translations?: Record<string, string>;
  }): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating price rule', { name: price.name });

      // Shopware uses rule builder for prices
      // For simplicity, we'll create a basic rule
      const ruleId = this.generateUuid();
      await this.http.post('/api/rule', {
        id: ruleId,
        name: price.name,
        priority: 100,
      });

      return {
        id: ruleId,
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create price rule', { name: price.name, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing price
   */
  async updatePrice(
    id: string,
    price: {
      name?: string;
      type?: string;
      isGross?: boolean;
      translations?: Record<string, string>;
    }
  ): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Updating price rule', { id });

      await this.http.patch(`/api/rule/${id}`, {
        name: price.name,
      });

      return {
        id,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update price rule', { id, error: errorMessage });

      return {
        id,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get price by ID
   */
  async getPriceById(id: string): Promise<{ id: string; name: string; type: string } | null> {
    try {
      const response = await this.http.get(`/api/rule/${id}`);
      return {
        id: response.data.data.id,
        name: response.data.data.name,
        type: 'rule',
      };
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.log.error('Failed to get price rule', { id, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if price exists by ID
   */
  async priceExists(id: string): Promise<boolean> {
    const price = await this.getPriceById(id);
    return price !== null;
  }

  // ============================================
  // MANUFACTURER METHODS
  // ============================================

  /**
   * Create a new manufacturer
   */
  async createManufacturer(manufacturer: ShopwareManufacturer): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating manufacturer', { name: manufacturer.name });

      const payload = this.buildManufacturerPayload(manufacturer);
      const response = await this.http.post('/api/product-manufacturer', payload);

      // Extract created ID from response (Shopware returns it in different ways)
      const createdId = response.data?.data?.id || response.data?.id || response.headers?.location?.split('/').pop();

      this.log.info('Manufacturer created', { name: manufacturer.name, id: createdId });

      return {
        id: createdId || '',
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create manufacturer', { name: manufacturer.name, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing manufacturer by ID
   */
  async updateManufacturer(id: string, manufacturer: Partial<ShopwareManufacturer>): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Updating manufacturer', { id });

      const payload = this.buildManufacturerPayload(manufacturer);
      await this.http.patch(`/api/product-manufacturer/${id}`, payload);

      return {
        id,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update manufacturer', { id, error: errorMessage });

      return {
        id,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get manufacturer by ID
   */
  async getManufacturerById(id: string): Promise<ShopwareManufacturer | null> {
    try {
      const response = await this.http.get(`/api/product-manufacturer/${id}`);
      return this.mapApiResponseToManufacturer(response.data.data);
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.log.error('Failed to get manufacturer', { id, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if manufacturer exists by ID
   */
  async manufacturerExists(id: string): Promise<boolean> {
    const manufacturer = await this.getManufacturerById(id);
    return manufacturer !== null;
  }

  /**
   * Bulk sync manufacturers
   */
  async bulkSyncManufacturers(manufacturers: ShopwareManufacturer[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Bulk syncing manufacturers', { count: manufacturers.length });

    try {
      const payload = manufacturers.map((m) => this.buildManufacturerPayload(m));

      await this.http.post('/api/_action/sync', {
        'upsert-manufacturer': {
          entity: 'product_manufacturer',
          action: 'upsert',
          payload,
        },
      });

      return {
        success: true,
        results: manufacturers.map((m) => ({
          productNumber: '',
          shopwareId: m.id,
          action: 'create' as const,
          success: true,
        })),
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Bulk manufacturer sync failed', { error: errorMessage });

      return {
        success: false,
        results: manufacturers.map((m) => ({
          productNumber: '',
          shopwareId: m.id,
          action: 'create' as const,
          success: false,
          error: errorMessage,
        })),
      };
    }
  }

  // ============================================
  // UNIT METHODS
  // ============================================

  /**
   * Create a new unit
   */
  async createUnit(unit: ShopwareUnit): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Creating unit', { shortCode: unit.shortCode });

      const payload = this.buildUnitPayload(unit);
      const response = await this.http.post('/api/unit', payload);

      // Extract created ID from response
      const createdId = response.data?.data?.id || response.data?.id || response.headers?.location?.split('/').pop();

      this.log.info('Unit created', { shortCode: unit.shortCode, id: createdId });

      return {
        id: createdId || '',
        productNumber: '',
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to create unit', { shortCode: unit.shortCode, error: errorMessage });

      return {
        id: '',
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing unit by ID
   */
  async updateUnit(id: string, unit: Partial<ShopwareUnit>): Promise<ShopwareSyncResult> {
    try {
      this.log.info('Updating unit', { id });

      const payload = this.buildUnitPayload(unit);
      await this.http.patch(`/api/unit/${id}`, payload);

      return {
        id,
        productNumber: '',
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Failed to update unit', { id, error: errorMessage });

      return {
        id,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get unit by ID
   */
  async getUnitById(id: string): Promise<ShopwareUnit | null> {
    try {
      const response = await this.http.get(`/api/unit/${id}`);
      return this.mapApiResponseToUnit(response.data.data);
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.log.error('Failed to get unit', { id, error: this.extractErrorMessage(error) });
      return null;
    }
  }

  /**
   * Check if unit exists by ID
   */
  async unitExists(id: string): Promise<boolean> {
    const unit = await this.getUnitById(id);
    return unit !== null;
  }

  /**
   * Bulk sync units
   */
  async bulkSyncUnits(units: ShopwareUnit[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Bulk syncing units', { count: units.length });

    try {
      const payload = units.map((u) => this.buildUnitPayload(u));

      await this.http.post('/api/_action/sync', {
        'upsert-unit': {
          entity: 'unit',
          action: 'upsert',
          payload,
        },
      });

      return {
        success: true,
        results: units.map((u) => ({
          productNumber: '',
          shopwareId: u.id,
          action: 'create' as const,
          success: true,
        })),
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.log.error('Bulk unit sync failed', { error: errorMessage });

      return {
        success: false,
        results: units.map((u) => ({
          productNumber: '',
          shopwareId: u.id,
          action: 'create' as const,
          success: false,
          error: errorMessage,
        })),
      };
    }
  }

  // ============================================
  // PAYLOAD BUILDERS
  // ============================================

  private buildProductPayload(product: Partial<ShopwareProduct>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};

    if (product.id) payload.id = product.id;
    if (product.productNumber) payload.productNumber = product.productNumber;
    if (product.name !== undefined) payload.name = product.name;
    if (product.description !== undefined) payload.description = product.description;
    if (product.stock !== undefined) payload.stock = product.stock;
    if (product.active !== undefined) payload.active = product.active;
    if (product.price) payload.price = product.price;
    if (product.taxId) payload.taxId = product.taxId;
    if (product.manufacturerId) payload.manufacturerId = product.manufacturerId;
    if (product.unitId) payload.unitId = product.unitId;
    if (product.categories) {
      payload.categories = product.categories.map((c) => ({ id: c.id }));
    }
    if (product.properties) {
      payload.properties = product.properties.map((p) => ({ id: p.id }));
    }
    if (product.translations) payload.translations = product.translations;

    // Remove internal tracking fields
    delete payload._plentyItemId;
    delete payload._plentyVariationId;

    return payload;
  }

  private buildCategoryPayload(category: Partial<ShopwareCategory>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};

    if (category.id) payload.id = category.id;
    if (category.parentId) payload.parentId = category.parentId;
    if (category.name !== undefined) payload.name = category.name;
    if (category.active !== undefined) payload.active = category.active;
    if (category.visible !== undefined) payload.visible = category.visible;
    if (category.translations) payload.translations = category.translations;

    // Remove internal tracking fields
    delete payload._plentyCategoryId;

    return payload;
  }

  private buildPropertyGroupPayload(group: Partial<ShopwarePropertyGroup>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};

    if (group.id) payload.id = group.id;
    if (group.name !== undefined) payload.name = group.name;
    if (group.displayType) payload.displayType = group.displayType;
    if (group.sortingType) payload.sortingType = group.sortingType;
    if (group.position !== undefined) payload.position = group.position;
    if (group.translations) payload.translations = group.translations;

    // Remove internal tracking fields
    delete payload._plentyAttributeId;

    return payload;
  }

  private buildPropertyOptionPayload(option: Partial<ShopwarePropertyOption>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};

    if (option.id) payload.id = option.id;
    if (option.groupId) payload.groupId = option.groupId;
    if (option.name !== undefined) payload.name = option.name;
    if (option.position !== undefined) payload.position = option.position;
    if (option.colorHexCode) payload.colorHexCode = option.colorHexCode;
    if (option.mediaId) payload.mediaId = option.mediaId;
    if (option.translations) payload.translations = option.translations;

    // Remove internal tracking fields
    delete payload._plentyAttributeId;
    delete payload._plentyAttributeValueId;

    return payload;
  }

  private buildManufacturerPayload(manufacturer: Partial<ShopwareManufacturer>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};

    if (manufacturer.id) payload.id = manufacturer.id;
    if (manufacturer.name !== undefined) payload.name = manufacturer.name;
    // Include link even if empty/null to allow clearing the field in Shopware
    if ('link' in manufacturer) payload.link = manufacturer.link || null;
    if ('description' in manufacturer) payload.description = manufacturer.description || null;
    if (manufacturer.mediaId) payload.mediaId = manufacturer.mediaId;
    if (manufacturer.translations) payload.translations = manufacturer.translations;

    // Remove internal tracking fields
    delete payload._plentyManufacturerId;

    return payload;
  }

  private buildUnitPayload(unit: Partial<ShopwareUnit>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};

    if (unit.id) payload.id = unit.id;
    if (unit.shortCode) payload.shortCode = unit.shortCode;
    if (unit.name !== undefined) payload.name = unit.name;
    if (unit.translations) payload.translations = unit.translations;

    // Remove internal tracking fields
    delete payload._plentyUnitId;

    return payload;
  }

  // ============================================
  // RESPONSE MAPPERS
  // ============================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapApiResponseToProduct(data: any): ShopwareProduct {
    return {
      id: data.id,
      productNumber: data.productNumber,
      name: data.name,
      description: data.description,
      stock: data.stock,
      active: data.active,
      price: data.price,
      taxId: data.taxId,
      manufacturerId: data.manufacturerId,
      unitId: data.unitId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapApiResponseToCategory(data: any): ShopwareCategory {
    return {
      id: data.id,
      parentId: data.parentId,
      name: data.name,
      active: data.active,
      visible: data.visible,
      level: data.level,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapApiResponseToPropertyGroup(data: any): ShopwarePropertyGroup {
    return {
      id: data.id,
      name: data.name,
      displayType: data.displayType,
      sortingType: data.sortingType,
      position: data.position,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapApiResponseToPropertyOption(data: any): ShopwarePropertyOption {
    return {
      id: data.id,
      groupId: data.groupId,
      name: data.name,
      position: data.position,
      colorHexCode: data.colorHexCode,
      mediaId: data.mediaId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapApiResponseToManufacturer(data: any): ShopwareManufacturer {
    return {
      id: data.id,
      name: data.name,
      link: data.link,
      description: data.description,
      mediaId: data.mediaId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapApiResponseToUnit(data: any): ShopwareUnit {
    return {
      id: data.id,
      shortCode: data.shortCode,
      name: data.name,
    };
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  private extractErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      const responseData = error.response?.data;
      if (responseData?.errors?.[0]?.detail) {
        return responseData.errors[0].detail;
      }
      if (responseData?.message) {
        return responseData.message;
      }
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Generate a UUID v4 for Shopware entities
   */
  private generateUuid(): string {
    // Use crypto if available, fallback to simple implementation
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }

    // Simple UUID v4 implementation
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
