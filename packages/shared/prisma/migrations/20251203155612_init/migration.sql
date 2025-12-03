-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('CONFIG', 'FULL_PRODUCT', 'PRODUCT_DELTA', 'STOCK', 'ORDER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PLENTY_TO_SHOPWARE', 'SHOPWARE_TO_PLENTY', 'BI_DIRECTIONAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plenty_url" TEXT NOT NULL,
    "plenty_credentials" TEXT NOT NULL,
    "shopware_url" TEXT NOT NULL,
    "shopware_credentials" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "config_sync_settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sync_type" "SyncType" NOT NULL,
    "cron_schedule" TEXT NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "direction" "SyncDirection" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "sync_type" "SyncType" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "metadata" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_created" INTEGER NOT NULL DEFAULT 0,
    "items_updated" INTEGER NOT NULL DEFAULT 0,
    "items_failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sync_type" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3) NOT NULL,
    "last_successful_sync_at" TIMESTAMP(3),
    "last_synced_plenty_item_id" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" "SyncType" NOT NULL,
    "plenty_field" TEXT NOT NULL,
    "shopware_field" TEXT NOT NULL,
    "transformation_rule" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "default_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "entity_type" "SyncType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plenty_categories" (
    "id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT,
    "linklist" BOOLEAN NOT NULL DEFAULT false,
    "right" TEXT,
    "sitemap" BOOLEAN NOT NULL DEFAULT false,
    "has_children" BOOLEAN NOT NULL DEFAULT false,
    "names" JSONB,
    "raw_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plenty_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plenty_attributes" (
    "id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "backend_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_surcharge_percental" BOOLEAN NOT NULL DEFAULT false,
    "is_linkable_to_image" BOOLEAN NOT NULL DEFAULT false,
    "amazon_attribute" TEXT,
    "fruugo_attribute" TEXT,
    "pixmania_attribute" INTEGER,
    "google_shopping_attribute" TEXT,
    "attribute_values" JSONB,
    "names" JSONB,
    "raw_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plenty_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plenty_sales_prices" (
    "id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "minimum_order_quantity" DOUBLE PRECISION,
    "type" TEXT NOT NULL,
    "is_customer_price" BOOLEAN NOT NULL DEFAULT false,
    "is_displayed_by_default" BOOLEAN NOT NULL DEFAULT false,
    "is_live_conversion" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT,
    "country_ids" JSONB,
    "customer_class_ids" JSONB,
    "referrer_ids" JSONB,
    "names" JSONB,
    "raw_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plenty_sales_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plenty_manufacturers" (
    "id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_name" TEXT,
    "logo" TEXT,
    "url" TEXT,
    "street" TEXT,
    "house_no" TEXT,
    "postcode" TEXT,
    "town" TEXT,
    "phone_number" TEXT,
    "fax_number" TEXT,
    "email" TEXT,
    "country_id" INTEGER,
    "pixmania_brand_id" INTEGER,
    "neckermann_brand_id" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "la_redoute_brand_id" INTEGER,
    "raw_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plenty_manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plenty_units" (
    "id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "unit_of_measurement" TEXT NOT NULL,
    "is_decimal_places_allowed" BOOLEAN NOT NULL DEFAULT false,
    "names" JSONB,
    "raw_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plenty_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "product_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_gross" DECIMAL(10,2) NOT NULL,
    "price_net" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "plenty_item_id" INTEGER,
    "plenty_variation_id" INTEGER,
    "raw_plenty_data" JSONB,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "plenty_updated_at" TIMESTAMP(3),

    CONSTRAINT "mock_shopware_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "sync_schedules_next_run_at_enabled_idx" ON "sync_schedules"("next_run_at", "enabled");

-- CreateIndex
CREATE INDEX "sync_schedules_tenant_id_enabled_idx" ON "sync_schedules"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "sync_schedules_tenant_id_sync_type_direction_key" ON "sync_schedules"("tenant_id", "sync_type", "direction");

-- CreateIndex
CREATE INDEX "sync_jobs_tenant_id_status_idx" ON "sync_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_status_created_at_idx" ON "sync_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "sync_jobs_schedule_id_idx" ON "sync_jobs"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_state_tenant_id_sync_type_key" ON "sync_state"("tenant_id", "sync_type");

-- CreateIndex
CREATE INDEX "sync_mappings_tenant_id_entity_type_idx" ON "sync_mappings"("tenant_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "sync_mappings_tenant_id_entity_type_plenty_field_key" ON "sync_mappings"("tenant_id", "entity_type", "plenty_field");

-- CreateIndex
CREATE INDEX "sync_logs_tenant_id_created_at_idx" ON "sync_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "sync_logs_job_id_idx" ON "sync_logs"("job_id");

-- CreateIndex
CREATE INDEX "sync_logs_entity_id_idx" ON "sync_logs"("entity_id");

-- CreateIndex
CREATE INDEX "plenty_categories_tenant_id_idx" ON "plenty_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "plenty_categories_tenant_id_parent_id_idx" ON "plenty_categories"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "plenty_categories_tenant_id_id_key" ON "plenty_categories"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "plenty_attributes_tenant_id_idx" ON "plenty_attributes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "plenty_attributes_tenant_id_id_key" ON "plenty_attributes"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "plenty_sales_prices_tenant_id_idx" ON "plenty_sales_prices"("tenant_id");

-- CreateIndex
CREATE INDEX "plenty_sales_prices_tenant_id_type_idx" ON "plenty_sales_prices"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "plenty_sales_prices_tenant_id_id_key" ON "plenty_sales_prices"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "plenty_manufacturers_tenant_id_idx" ON "plenty_manufacturers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "plenty_manufacturers_tenant_id_id_key" ON "plenty_manufacturers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "plenty_units_tenant_id_idx" ON "plenty_units"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "plenty_units_tenant_id_id_key" ON "plenty_units"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "mock_shopware_products_tenant_id_sku_idx" ON "mock_shopware_products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "mock_shopware_products_tenant_id_plenty_variation_id_idx" ON "mock_shopware_products"("tenant_id", "plenty_variation_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_products_tenant_id_sku_key" ON "mock_shopware_products"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "sync_schedules" ADD CONSTRAINT "sync_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "sync_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_mappings" ADD CONSTRAINT "sync_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plenty_categories" ADD CONSTRAINT "plenty_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plenty_attributes" ADD CONSTRAINT "plenty_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plenty_sales_prices" ADD CONSTRAINT "plenty_sales_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plenty_manufacturers" ADD CONSTRAINT "plenty_manufacturers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plenty_units" ADD CONSTRAINT "plenty_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_products" ADD CONSTRAINT "mock_shopware_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
