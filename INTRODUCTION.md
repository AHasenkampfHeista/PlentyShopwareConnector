# Plentymarkets to Shopware Connector

Automatically sync your product catalog from Plentymarkets to Shopware 6.

## What Does It Do?

This connector keeps your Shopware storefront in sync with your Plentymarkets ERP. Once configured, it automatically transfers and updates your product data - no manual exports or imports needed.

## What Gets Synced?

### Categories
Your complete category structure including hierarchy and names.

### Products
- Product names and descriptions
- Prices (standard price and RRP)
- Stock levels
- Product images
- EAN/barcodes
- Category assignments

### Variants
Parent products with all their variants (e.g., a t-shirt in multiple sizes and colors).

### Attributes & Properties
Product attributes like Size, Color, Material - automatically created as property groups in Shopware.

### Manufacturers
Brand and manufacturer information.

### Units
Measurement units (pieces, kg, liters, etc.).

## How Often Does It Sync?

- **Configuration data** (categories, attributes, manufacturers): Hourly
- **Product updates**: Hourly (only changed products)
- **Full catalog sync**: On demand or scheduled

## What's Next?

Ready to connect your shop? Follow the [Setup Guide](./SETUP_GUIDE.md) to configure your connection.
