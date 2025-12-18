# Setup Guide

This guide walks you through connecting your Plentymarkets shop to Shopware.

## Step 1: Gather Your Credentials

### Plentymarkets API Credentials

You'll need a REST API user from your Plentymarkets system.

1. Go to **Setup > Settings > User > Accounts**
2. Create a new user or use an existing one with API access
3. Note down:
   - **API URL**: `https://your-shop.plentymarkets-cloud01.com`
   - **Username**: Your API username
   - **Password**: Your API password

### Shopware API Credentials

You'll need an Integration from your Shopware Admin.

1. Go to **Settings > System > Integrations**
2. Click **Add integration**
3. Give it a name (e.g., "Plentymarkets Connector")
4. Enable **Administrator** access
5. Save and note down:
   - **Access key ID** (Client ID)
   - **Secret access key** (Client Secret)

---

## Step 2: Configure Your Connection

### Basic Settings

| Setting | Description | Example |
|---------|-------------|---------|
| **Plentymarkets URL** | Your Plenty API endpoint | `https://your-shop.plentymarkets-cloud01.com` |
| **Plentymarkets Frontend URL** | Your Plenty webshop URL (for images) | `https://your-shop.de` |
| **Shopware URL** | Your Shopware shop URL | `https://your-shopware.com` |

### Price Configuration

Find your Sales Price IDs in Plentymarkets under **Setup > Item > Sales prices**.

| Setting | Description |
|---------|-------------|
| **Default Sales Price ID** | The Plenty sales price used as the main selling price |
| **RRP Sales Price ID** | The Plenty sales price used for "was" / list price (optional) |

### Category Settings

| Setting | Where to find it |
|---------|------------------|
| **Shopware Root Category** | In Shopware Admin: **Catalogues > Categories** - select the category where all Plenty categories should appear |

### Sales Channel

| Setting | Where to find it |
|---------|------------------|
| **Shopware Sales Channel** | In Shopware Admin: **Sales Channels** - select which storefront should display the synced products |

### Tax Mapping

Map your Plentymarkets tax rates to Shopware tax rules.

**Plentymarkets Tax IDs:**
- `0` = Tax rate A (typically 19% in Germany)
- `1` = Tax rate B (typically 7% in Germany)
- `2` = Tax rate C
- `3` = Tax rate D

Find your Shopware tax IDs in **Settings > Tax**.

| Plenty Tax ID | Shopware Tax |
|---------------|--------------|
| 0 | Standard rate (19%) |
| 1 | Reduced rate (7%) |

---

## Step 3: Initial Sync

Once configured, the connector will:

1. **First**: Sync your configuration (categories, attributes, properties, manufacturers, units)
2. **Then**: Sync all your products

The initial full sync may take some time depending on your catalog size.

---

## Step 4: Ongoing Synchronization

After the initial sync, the connector automatically:

- Syncs configuration changes **every hour**
- Syncs product updates **every hour** (only changed products)

---

## Configuration Reference

| Setting | Required | Description |
|---------|----------|-------------|
| Plentymarkets URL | Yes | Your Plenty API endpoint |
| Plentymarkets Credentials | Yes | API username and password |
| Plentymarkets Frontend URL | Yes | Your webshop URL for images |
| Shopware URL | Yes | Your Shopware endpoint |
| Shopware Credentials | Yes | Integration client ID and secret |
| Default Sales Price ID | Yes | Plenty sales price for main price |
| RRP Sales Price ID | No | Plenty sales price for list price |
| Shopware Root Category | Yes | Parent category for all synced categories |
| Shopware Sales Channel | Yes | Where products will be visible |
| Tax Mappings | Yes | Plenty tax IDs → Shopware tax rules |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Products not visible in shop | Check that the correct Sales Channel is configured |
| Wrong prices showing | Verify the Default Sales Price ID matches your Plenty setup |
| Categories not appearing | Ensure the Root Category is set correctly |
| Images not loading | Check the Plentymarkets Frontend URL is correct |
| Tax calculation errors | Verify all tax mappings are configured |

---

Need more details about what gets synced? See the [Introduction](./INTRODUCTION.md).
