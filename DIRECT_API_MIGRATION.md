# Password-free UTM Track rollout

This branch removes the extra dashboard password, uses Shopify App Bridge Direct API for order data, and disables the Render /api endpoint.
Do not merge before enabling Direct API on the EXISTING UTM Track app.

## Shopify configuration (required before merging)

The repository has no shopify.app.toml because the app is currently Dev Dashboard managed.
Follow Shopify's official guide for migrating Dev Dashboard app configuration to Shopify CLI:
https://shopify.dev/docs/apps/build/cli-for-apps/migrate-from-dashboard

1. Set up a minimal Shopify CLI config project as described by the official guide.
2. Run shopify app config link and choose the existing UTM Track app, not UTM Tracking.
3. Preserve the imported app URL, embedded setting and scopes exactly.
4. Under the existing [access.admin] table in shopify.app.toml, set:
   embedded_app_direct_api_access = true
   direct_api_mode = "online"
   Do not create a duplicate [access.admin] table.
5. Keep read_orders scope and any existing read_customers permissions.
6. Run shopify app deploy to publish the app configuration version; verify in Dev Dashboard.
7. ONLY THEN merge this branch into main; Render will auto-deploy the web code.

## Safety and acceptance

- The main branch stays untouched until Shopify Direct API is enabled.
- The new server /api returns 404, and does not expose private Shopify order data.
- Order data is fetched by the browser only in Shopify Admin with automatically authenticated Direct API.
- Order date boundaries retain 00:00:00–23:59:59 +03:00.
- Check Today, Yesterday, Products, Campaign Performance and UTM attributes before confirming.
- Older orders can require read_all_orders and Shopify approval.
- Rollback is simply reverting the main branch merge.
