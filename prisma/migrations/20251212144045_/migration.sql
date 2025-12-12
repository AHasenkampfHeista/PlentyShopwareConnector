-- CreateEnum
CREATE TYPE "MappingType" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "MediaSourceType" AS ENUM ('MANUFACTURER_LOGO', 'PRODUCT_IMAGE', 'CATEGORY_IMAGE', 'PROPERTY_OPTION_IMAGE', 'OTHER');

-- CreateTable
CREATE TABLE "product_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_item_id" INTEGER NOT NULL,
    "plenty_variation_id" INTEGER NOT NULL,
    "shopware_product_id" TEXT NOT NULL,
    "shopware_product_number" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_category_id" INTEGER NOT NULL,
    "shopware_category_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "level" INTEGER NOT NULL DEFAULT 1,
    "plenty_category_id" INTEGER,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_attribute_id" INTEGER NOT NULL,
    "shopware_property_group_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_value_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_attribute_id" INTEGER NOT NULL,
    "plenty_attribute_value_id" INTEGER NOT NULL,
    "shopware_property_group_id" TEXT NOT NULL,
    "shopware_property_option_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_value_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_price_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_sales_price_id" INTEGER NOT NULL,
    "shopware_price_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_price_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_property_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_type" TEXT NOT NULL DEFAULT 'text',
    "sorting_type" TEXT NOT NULL DEFAULT 'alphanumeric',
    "position" INTEGER NOT NULL DEFAULT 0,
    "plenty_attribute_id" INTEGER,
    "translations" JSONB,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_property_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_property_options" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "property_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "color_hex_code" TEXT,
    "media_id" TEXT,
    "plenty_attribute_id" INTEGER,
    "plenty_attribute_value_id" INTEGER,
    "translations" JSONB,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_property_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_prices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'default',
    "is_gross" BOOLEAN NOT NULL DEFAULT true,
    "quantity_start" INTEGER DEFAULT 1,
    "quantity_end" INTEGER,
    "rule_id" TEXT,
    "currency_id" TEXT,
    "plenty_sales_price_id" INTEGER,
    "translations" JSONB,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturer_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_manufacturer_id" INTEGER NOT NULL,
    "shopware_manufacturer_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturer_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_manufacturers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT,
    "description" TEXT,
    "media_id" TEXT,
    "plenty_manufacturer_id" INTEGER,
    "translations" JSONB,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_unit_id" INTEGER NOT NULL,
    "shopware_unit_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_units" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "short_code" TEXT NOT NULL,
    "name" TEXT,
    "plenty_unit_id" INTEGER,
    "translations" JSONB,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_url_hash" TEXT NOT NULL,
    "source_type" "MediaSourceType" NOT NULL,
    "source_entity_id" TEXT,
    "shopware_media_id" TEXT NOT NULL,
    "shopware_folder_id" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_shopware_media" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER,
    "title" TEXT,
    "alt" TEXT,
    "folder_id" TEXT,
    "folder_name" TEXT,
    "source_url" TEXT,
    "raw_shopware_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_shopware_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_mappings_tenant_id_shopware_product_number_idx" ON "product_mappings"("tenant_id", "shopware_product_number");

-- CreateIndex
CREATE INDEX "product_mappings_tenant_id_plenty_item_id_idx" ON "product_mappings"("tenant_id", "plenty_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_mappings_tenant_id_plenty_variation_id_key" ON "product_mappings"("tenant_id", "plenty_variation_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_mappings_tenant_id_shopware_product_id_key" ON "product_mappings"("tenant_id", "shopware_product_id");

-- CreateIndex
CREATE INDEX "category_mappings_tenant_id_mapping_type_idx" ON "category_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "category_mappings_tenant_id_plenty_category_id_key" ON "category_mappings"("tenant_id", "plenty_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_mappings_tenant_id_shopware_category_id_key" ON "category_mappings"("tenant_id", "shopware_category_id");

-- CreateIndex
CREATE INDEX "mock_shopware_categories_tenant_id_parent_id_idx" ON "mock_shopware_categories"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_categories_tenant_id_plenty_category_id_key" ON "mock_shopware_categories"("tenant_id", "plenty_category_id");

-- CreateIndex
CREATE INDEX "attribute_mappings_tenant_id_mapping_type_idx" ON "attribute_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_mappings_tenant_id_plenty_attribute_id_key" ON "attribute_mappings"("tenant_id", "plenty_attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_mappings_tenant_id_shopware_property_group_id_key" ON "attribute_mappings"("tenant_id", "shopware_property_group_id");

-- CreateIndex
CREATE INDEX "attribute_value_mappings_tenant_id_plenty_attribute_id_idx" ON "attribute_value_mappings"("tenant_id", "plenty_attribute_id");

-- CreateIndex
CREATE INDEX "attribute_value_mappings_tenant_id_mapping_type_idx" ON "attribute_value_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_value_mappings_tenant_id_plenty_attribute_value_i_key" ON "attribute_value_mappings"("tenant_id", "plenty_attribute_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_value_mappings_tenant_id_shopware_property_option_key" ON "attribute_value_mappings"("tenant_id", "shopware_property_option_id");

-- CreateIndex
CREATE INDEX "sales_price_mappings_tenant_id_mapping_type_idx" ON "sales_price_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "sales_price_mappings_tenant_id_plenty_sales_price_id_key" ON "sales_price_mappings"("tenant_id", "plenty_sales_price_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_price_mappings_tenant_id_shopware_price_id_key" ON "sales_price_mappings"("tenant_id", "shopware_price_id");

-- CreateIndex
CREATE INDEX "mock_shopware_property_groups_tenant_id_idx" ON "mock_shopware_property_groups"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_property_groups_tenant_id_plenty_attribute_id_key" ON "mock_shopware_property_groups"("tenant_id", "plenty_attribute_id");

-- CreateIndex
CREATE INDEX "mock_shopware_property_options_tenant_id_property_group_id_idx" ON "mock_shopware_property_options"("tenant_id", "property_group_id");

-- CreateIndex
CREATE INDEX "mock_shopware_property_options_tenant_id_plenty_attribute_i_idx" ON "mock_shopware_property_options"("tenant_id", "plenty_attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_property_options_tenant_id_plenty_attribute_v_key" ON "mock_shopware_property_options"("tenant_id", "plenty_attribute_value_id");

-- CreateIndex
CREATE INDEX "mock_shopware_prices_tenant_id_idx" ON "mock_shopware_prices"("tenant_id");

-- CreateIndex
CREATE INDEX "mock_shopware_prices_tenant_id_type_idx" ON "mock_shopware_prices"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_prices_tenant_id_plenty_sales_price_id_key" ON "mock_shopware_prices"("tenant_id", "plenty_sales_price_id");

-- CreateIndex
CREATE INDEX "manufacturer_mappings_tenant_id_mapping_type_idx" ON "manufacturer_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturer_mappings_tenant_id_plenty_manufacturer_id_key" ON "manufacturer_mappings"("tenant_id", "plenty_manufacturer_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturer_mappings_tenant_id_shopware_manufacturer_id_key" ON "manufacturer_mappings"("tenant_id", "shopware_manufacturer_id");

-- CreateIndex
CREATE INDEX "mock_shopware_manufacturers_tenant_id_idx" ON "mock_shopware_manufacturers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_manufacturers_tenant_id_plenty_manufacturer_i_key" ON "mock_shopware_manufacturers"("tenant_id", "plenty_manufacturer_id");

-- CreateIndex
CREATE INDEX "unit_mappings_tenant_id_mapping_type_idx" ON "unit_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "unit_mappings_tenant_id_plenty_unit_id_key" ON "unit_mappings"("tenant_id", "plenty_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_mappings_tenant_id_shopware_unit_id_key" ON "unit_mappings"("tenant_id", "shopware_unit_id");

-- CreateIndex
CREATE INDEX "mock_shopware_units_tenant_id_idx" ON "mock_shopware_units"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_units_tenant_id_plenty_unit_id_key" ON "mock_shopware_units"("tenant_id", "plenty_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_shopware_units_tenant_id_short_code_key" ON "mock_shopware_units"("tenant_id", "short_code");

-- CreateIndex
CREATE INDEX "media_mappings_tenant_id_source_type_idx" ON "media_mappings"("tenant_id", "source_type");

-- CreateIndex
CREATE INDEX "media_mappings_tenant_id_source_entity_id_idx" ON "media_mappings"("tenant_id", "source_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_mappings_tenant_id_source_url_hash_key" ON "media_mappings"("tenant_id", "source_url_hash");

-- CreateIndex
CREATE UNIQUE INDEX "media_mappings_tenant_id_shopware_media_id_key" ON "media_mappings"("tenant_id", "shopware_media_id");

-- CreateIndex
CREATE INDEX "mock_shopware_media_tenant_id_idx" ON "mock_shopware_media"("tenant_id");

-- CreateIndex
CREATE INDEX "mock_shopware_media_tenant_id_folder_id_idx" ON "mock_shopware_media"("tenant_id", "folder_id");

-- AddForeignKey
ALTER TABLE "product_mappings" ADD CONSTRAINT "product_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_mappings" ADD CONSTRAINT "category_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_categories" ADD CONSTRAINT "mock_shopware_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_mappings" ADD CONSTRAINT "attribute_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_value_mappings" ADD CONSTRAINT "attribute_value_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_price_mappings" ADD CONSTRAINT "sales_price_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_property_groups" ADD CONSTRAINT "mock_shopware_property_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_property_options" ADD CONSTRAINT "mock_shopware_property_options_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_prices" ADD CONSTRAINT "mock_shopware_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer_mappings" ADD CONSTRAINT "manufacturer_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_manufacturers" ADD CONSTRAINT "mock_shopware_manufacturers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_mappings" ADD CONSTRAINT "unit_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_units" ADD CONSTRAINT "mock_shopware_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_mappings" ADD CONSTRAINT "media_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_shopware_media" ADD CONSTRAINT "mock_shopware_media_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
