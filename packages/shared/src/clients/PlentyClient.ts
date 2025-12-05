import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import {
  PlentyCredentials,
  PlentyAuthResponse,
  PlentyPaginatedResponse,
  PlentyVariation,
  PlentyVariationQueryParams,
  PlentyCategory,
  PlentyCategoryQueryParams,
  PlentyAttribute,
  PlentySalesPrice,
  PlentyManufacturer,
  PlentyUnit,
} from '../types/plenty';

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_ITEMS_PER_PAGE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface PlentyClientConfig {
  baseUrl: string;
  credentials: PlentyCredentials;
  timeout?: number;
}

export class PlentyClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private credentials: PlentyCredentials;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private log = createLogger({ client: 'PlentyClient' });

  constructor(config: PlentyClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.credentials = config.credentials;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeout || DEFAULT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // Add request interceptor for auth token
    this.client.interceptors.request.use(async (config) => {
      if (this.accessToken && !this.isTokenExpired()) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Token expired, try to re-authenticate
          this.log.warn('Token expired, re-authenticating');
          await this.authenticate();
          // Retry the original request
          if (error.config) {
            error.config.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.client.request(error.config);
          }
        }
        throw error;
      }
    );
  }

  private isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return true;
    // Consider token expired 5 minutes before actual expiry
    return new Date() >= new Date(this.tokenExpiresAt.getTime() - 5 * 60 * 1000);
  }

  /**
   * Authenticate with Plenty API
   */
  async authenticate(): Promise<void> {
    try {
      this.log.info('Authenticating with Plenty API', { baseUrl: this.baseUrl });

      const response = await axios.post<PlentyAuthResponse>(`${this.baseUrl}/rest/login`, {
        username: this.credentials.username,
        password: this.credentials.password,
      });

      this.accessToken = response.data.accessToken;
      this.tokenExpiresAt = new Date(Date.now() + response.data.expiresIn * 1000);

      this.log.info('Authentication successful', {
        expiresIn: response.data.expiresIn,
      });
    } catch (error) {
      const axiosError = error as AxiosError;
      this.log.error('Authentication failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw new Error(`Plenty authentication failed: ${axiosError.message}`);
    }
  }

  /**
   * Ensure we're authenticated before making API calls
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || this.isTokenExpired()) {
      await this.authenticate();
    }
  }

  /**
   * Generic GET request with retry logic
   */
  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    await this.ensureAuthenticated();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Log the full request URL for debugging
        const url = new URL(endpoint, this.baseUrl);
        if (params) {
          Object.entries(params).forEach(([key, value]) => {
            url.searchParams.append(key, String(value));
          });
        }
        console.log('Full Request URL:', url.toString());

        const response = await this.client.get<T>(endpoint, { params });
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;

        // Log detailed error information
        const errorDetails = {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          endpoint,
          params,
        };

        this.log.error('API request failed', errorDetails);

        // Also console.error for visibility
        console.error('PlentyMarkets API Error:', JSON.stringify(errorDetails, null, 2));

        lastError = new Error(
          `${axiosError.message} - ${JSON.stringify(axiosError.response?.data || {})}`
        );

        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (
          axiosError.response?.status &&
          axiosError.response.status >= 400 &&
          axiosError.response.status < 500 &&
          axiosError.response.status !== 429
        ) {
          throw lastError;
        }

        // Rate limit - wait longer
        if (axiosError.response?.status === 429) {
          const retryAfter = parseInt(axiosError.response.headers['retry-after'] || '60', 10);
          this.log.warn('Rate limited, waiting', { retryAfter, attempt });
          await this.delay(retryAfter * 1000);
          continue;
        }

        // Retry on server errors or network issues
        if (attempt < MAX_RETRIES) {
          this.log.warn('Request failed, retrying', {
            attempt,
            maxRetries: MAX_RETRIES,
            error: axiosError.message,
          });
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError || new Error('Request failed after max retries');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================
  // VARIATION ENDPOINTS (Main product data)
  // ============================================

  /**
   * Get variations with optional filters and included relations
   * This is the main endpoint for fetching products as per Plenty docs
   */
  async getVariations(
    params: PlentyVariationQueryParams = {}
  ): Promise<PlentyPaginatedResponse<PlentyVariation>> {
    const queryParams: Record<string, unknown> = {
      page: params.page || 1,
      itemsPerPage: params.itemsPerPage || DEFAULT_ITEMS_PER_PAGE,
    };

    if (params.with) {
      queryParams.with = params.with;
    }

    if (params.updatedBetween) {
      queryParams.updatedBetween = params.updatedBetween;
    }

    if (params.isActive !== undefined) {
      queryParams.isActive = params.isActive;
    }

    if (params.isMain !== undefined) {
      queryParams.isMain = params.isMain;
    }

    if (params.itemId) {
      queryParams.itemId = params.itemId;
    }

    if (params.lang) {
      queryParams.lang = params.lang;
    }

    console.log('\n=== PLENTY API REQUEST ===');
    console.log('Endpoint: /rest/items/variations');
    console.log('Params:', JSON.stringify(queryParams, null, 2));
    this.log.debug('Fetching variations', { params: queryParams });

    const response = await this.get<PlentyPaginatedResponse<PlentyVariation>>(
      '/rest/items/variations',
      queryParams
    );

    console.log('=== PLENTY API RESPONSE ===');
    console.log('Page:', response.page);
    console.log('Total Count:', response.totalsCount);
    console.log('Entries on this page:', response.entries.length);
    console.log('Is Last Page:', response.isLastPage);
    console.log('===========================\n');

    return response;
  }

  /**
   * Get all variations with automatic pagination
   * Use for full sync (be careful with large catalogs)
   */
  async getAllVariations(
    params: Omit<PlentyVariationQueryParams, 'page'> = {},
    onProgress?: (page: number, total: number) => void
  ): Promise<PlentyVariation[]> {
    const allVariations: PlentyVariation[] = [];
    let page = 1;
    let isLastPage = false;

    while (!isLastPage) {
      const response = await this.getVariations({ ...params, page });
      allVariations.push(...response.entries);

      if (onProgress) {
        onProgress(page, response.lastPageNumber);
      }

      isLastPage = response.isLastPage;
      page++;

      // Small delay to avoid rate limiting
      if (!isLastPage) {
        await this.delay(100);
      }
    }

    this.log.info('Fetched all variations', { count: allVariations.length });
    return allVariations;
  }

  /**
   * Get variations updated since a specific date (for delta sync)
   */
  async getVariationsDelta(
    since: Date,
    withRelations: string[] = [
      'variationSalesPrices',
      'variationBarcodes',
      'variationAttributeValues',
      'variationCategories',
      // Removed: 'stock', 'item', 'images' - testing minimal params
    ]
  ): Promise<PlentyVariation[]> {
    console.log('\n>>> getVariationsDelta called <<<');
    console.log('Input Date (since):', since);

    // Use Unix timestamp (seconds) - simpler and no encoding issues
    // API accepts both Unix timestamp and ISO 8601 format
    const unixTimestamp = Math.floor(since.getTime() / 1000);
    const updatedBetween = unixTimestamp.toString();

    console.log('Unix Timestamp:', updatedBetween);
    console.log('Human readable:', new Date(unixTimestamp * 1000).toISOString());
    this.log.info('Fetching delta variations', { since: new Date(unixTimestamp * 1000).toISOString() });

    return this.getAllVariations({
      updatedBetween,
      with: withRelations.join(','),
    });
  }

  // ============================================
  // CATEGORY ENDPOINTS
  // ============================================

  /**
   * Get categories with optional filters
   */
  async getCategories(
    params: PlentyCategoryQueryParams = {}
  ): Promise<PlentyPaginatedResponse<PlentyCategory>> {
    const queryParams: Record<string, unknown> = {
      page: params.page || 1,
      itemsPerPage: params.itemsPerPage || DEFAULT_ITEMS_PER_PAGE,
    };

    if (params.with) {
      queryParams.with = params.with;
    }

    if (params.parentId !== undefined) {
      queryParams.parentId = params.parentId;
    }

    if (params.type) {
      queryParams.type = params.type;
    }

    if (params.lang) {
      queryParams.lang = params.lang;
    }

    return this.get<PlentyPaginatedResponse<PlentyCategory>>('/rest/categories', queryParams);
  }

  /**
   * Get all categories with details
   */
  async getAllCategories(): Promise<PlentyCategory[]> {
    const allCategories: PlentyCategory[] = [];
    let page = 1;
    let isLastPage = false;

    while (!isLastPage) {
      const response = await this.getCategories({
        page,
        with: 'details',
      });
      allCategories.push(...response.entries);
      isLastPage = response.isLastPage;
      page++;

      if (!isLastPage) {
        await this.delay(100);
      }
    }

    this.log.info('Fetched all categories', { count: allCategories.length });
    return allCategories;
  }

  // ============================================
  // ATTRIBUTE ENDPOINTS
  // ============================================

  /**
   * Get all attributes with values
   */
  async getAttributes(): Promise<PlentyAttribute[]> {
    const response = await this.get<PlentyPaginatedResponse<PlentyAttribute>>(
      '/rest/items/attributes',
      {
        with: 'names,values',
        itemsPerPage: 250,
      }
    );

    this.log.info('Fetched attributes', { count: response.entries.length });
    return response.entries;
  }

  // ============================================
  // SALES PRICE ENDPOINTS
  // ============================================

  /**
   * Get all sales prices with names and relations
   */
  async getSalesPrices(): Promise<PlentySalesPrice[]> {
    const response = await this.get<PlentyPaginatedResponse<PlentySalesPrice>>(
      '/rest/items/sales_prices',
      {
        with: 'names,accounts,countries,currencies,customerClasses,referrers,clients',
        itemsPerPage: 250,
      }
    );

    this.log.info('Fetched sales prices', { count: response.entries.length });
    return response.entries;
  }

  // ============================================
  // MANUFACTURER ENDPOINTS
  // ============================================

  /**
   * Get all manufacturers
   */
  async getManufacturers(): Promise<PlentyManufacturer[]> {
    const allManufacturers: PlentyManufacturer[] = [];
    let page = 1;
    let isLastPage = false;

    while (!isLastPage) {
      const response = await this.get<PlentyPaginatedResponse<PlentyManufacturer>>(
        '/rest/items/manufacturers',
        { page, itemsPerPage: DEFAULT_ITEMS_PER_PAGE }
      );
      allManufacturers.push(...response.entries);
      isLastPage = response.isLastPage;
      page++;

      if (!isLastPage) {
        await this.delay(100);
      }
    }

    this.log.info('Fetched all manufacturers', { count: allManufacturers.length });
    return allManufacturers;
  }

  // ============================================
  // UNIT ENDPOINTS
  // ============================================

  /**
   * Get all units
   */
  async getUnits(): Promise<PlentyUnit[]> {
    const response = await this.get<PlentyPaginatedResponse<PlentyUnit>>('/rest/items/units', {
      with: 'names',
      itemsPerPage: 250,
    });

    this.log.info('Fetched units', { count: response.entries.length });
    return response.entries;
  }

  // ============================================
  // STOCK ENDPOINTS (for future use)
  // ============================================

  /**
   * Get stock for all variations in a warehouse
   */
  async getStock(_warehouseId?: number): Promise<PlentyVariation[]> {
    const params: PlentyVariationQueryParams = {
      with: 'stock',
      itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
    };

    return this.getAllVariations(params);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Test connection to Plenty API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      // Try a simple API call
      await this.getCategories({ itemsPerPage: 1 });
      return true;
    } catch (error) {
      this.log.error('Connection test failed', { error });
      return false;
    }
  }

  /**
   * Get current auth status
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null && !this.isTokenExpired();
  }
}
