# Multi-Vendor Marketplace with Dynamic Pricing

A modern web application that enables multiple vendors to list and sell products while leveraging automated, algorithmic dynamic pricing to maximize revenue and keep prices competitive.

## Core Features
- **Automated Dynamic Pricing Engine:** Adjusts prices based on demand spikes, inventory levels, and competitor rates.
- **Multi-Vendor Management:** Dashboard for sellers to onboard, set price guardrails (floors/ceilings), and manage stock.
- **Unified Shopping & Checkout:** Customer portal with real-time price updates and single cart checkout.
- **Admin Control Panel:** Platform operator dashboard to manage vendors and track commission payouts.

## Role-separated application routes

- `/` is the public product catalog and cart. Customer navigation only exposes customer shopping, orders, and verification.
- `/vendor/login` and `/vendor/dashboard` provide the vendor sign-in and seller-only product, stock, pricing, fulfillment, and store-settings tools.
- `/admin/login`, `/admin`, and `/admin/escrow` provide the separate administrator sign-in, paginated marketplace oversight, and escrow dispute operations.
- `/account/verification` shows the signed-in customer's verification tier and request status. Vendor verification is available from **Store Settings**.
- `DELIVERY_PARTNER` accounts are created by an administrator and can be assigned to escrow orders from **Delivery & riders**.

Backend role checks protect the vendor and admin APIs independently of the frontend route guards. Suspended accounts are denied sign-in and their existing bearer tokens are rejected by authenticated API routes.

### Tier 1 and Tier 2 verification

New accounts start at Tier 1. Submitting a legal name and identity-document type creates a Tier 2 review request; it does not mark the account as verified. An administrator may approve a request only after completing the identity check through the organization's approved external process. Checkout verifies the account's stored Tier 2 approval on the server and does not trust a browser-supplied verification flag.

This repository does not include an identity-verification provider integration or secure document intake. The current workflow deliberately does not collect identity numbers or documents and cannot perform automated KYC. Configure and integrate an approved identity provider before presenting Tier 2 as an automated or fully production-ready verification service.

The admin overview is available at `GET /api/admin/overview` and accepts `usersPage`, `ordersPage`, and `usersRole` (`accounts`, `vendors`, or `riders`) query parameters. Admin-only endpoints also support account suspension, identity review, delivery-partner creation, and order-to-rider assignment.

### Provisioning the platform administrator

The production-safe provisioning command targets `prominentchinonso27@gmail.com` by default, requires `MONGO_URI` (or `MONGODB_URI`), and never uses a default password or changes an existing password. It reads secrets from the ignored root `.env` file or the process environment; set:

```dotenv
MONGO_URI=<your MongoDB connection string>
ADMIN_BOOTSTRAP_EMAIL=prominentchinonso27@gmail.com
ADMIN_BOOTSTRAP_PASSWORD=<unique random password with at least 20 characters>
```

Run `npm --prefix backend run seed:admin` from the repository root. If this email already belongs to a customer/vendor account, explicitly confirm promotion with `npm --prefix backend run seed:admin -- --promote-existing`. Promotion preserves the existing password; the account owner can then sign in at `/admin/login` with their existing password. If no account exists, the command creates one with the supplied password hash. Re-running is safe and does not reset credentials.

For Kubernetes, copy `k8s/secrets.env.example` to the ignored `k8s/secrets.env`, fill it with deployment secrets, then apply it using `kubectl create secret generic app-secrets --from-env-file=k8s/secrets.env --dry-run=client -o yaml | kubectl apply -f -`. Never commit the filled secrets file.

**Credential rotation required:** credentials were previously stored in a committed Kubernetes secret manifest. Removing that file does not erase it from Git history. Rotate the MongoDB credential, JWT signing secret, and admin bootstrap password in the deployment secret store; invalidate previously issued JWTs by changing `JWT_SECRET`.

## Tech Stack
- **Frontend:** React.js, Tailwind CSS
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **Payment & APIs:** Paystack API
-

## Dynamic Pricing API

`POST /api/pricing/calculate` recalculates and saves a seller's product price.
Send a bearer token for a seller account (or an admin account) and a JSON body
containing `productId` and the editable pricing values `basePrice`,
`demandScore`, `stock`, `priceFloor`, and `priceCeiling`. A positive numeric
`competitorPrice` is optional. Recalculation saves these values and the
calculated `currentPrice`. Sellers can only reprice their own products.

The calculation starts from `basePrice` or the lower of `basePrice` and
`competitorPrice`, applies a demand adjustment of up to 10% based on
`demandScore` (0–100, with 50 neutral), adds 5% when stock is 1–5, and
subtracts 5% when stock is at least 50. The result is rounded to two decimal
places and clamped to the product's `priceFloor` and `priceCeiling`. The
response includes the saved `currentPrice`.

`GET /api/products/mine` returns the authenticated seller's products for the
vendor pricing dashboard. Admin accounts can use this endpoint to list all
products.

`GET /api/products/store/:vendorId` returns public store details and only the
products owned by that vendor. The frontend storefront is available at
`/store/:vendorId`.

Authenticated sellers can read `GET /api/auth/profile` and update their public
store profile with `PUT /api/auth/profile`. The update accepts `storeName`,
`storeLogo`, `storeBanner`, and `storeDescription`; image fields must be HTTP
or HTTPS URLs.

`POST /api/products` creates a product for the authenticated seller. Provide
`title`, `basePrice`, `stock`, `priceFloor`, and `priceCeiling`; `description`,
`category`, `demandScore`, and `competitorPrice` are optional. Product
ownership is assigned from the authenticated token, not from request data.
Optional product images are uploaded directly to Cloudinary and stored as
secure URLs. Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` in the backend environment (for example, in Render's
environment settings) to enable image uploads. Images must be JPEG, PNG, or
WebP and no larger than 5 MB. Use `PATCH /api/products/:productId` to update
product details or replace an image, and `DELETE /api/products/:productId` to
remove a product. Sellers can only update or remove their own listings.

To reassign all existing products to an account, configure `MONGO_URI`
and run `npm --prefix backend run reassign:products -- <USER_ID>
--confirm-reassign-all`. The command only proceeds when the ID belongs to an
existing account with the `SELLER` or `ADMIN` role. This operation transfers
ownership of every existing product document, including products currently
assigned to other sellers.

The public `GET /api/products` endpoint reads product documents from MongoDB.
Demo product seed data is not run on server startup.
