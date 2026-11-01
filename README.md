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
- `/rider/login` and `/rider/dashboard` provide an isolated delivery-partner sign-in and assigned-order pickup/delivery workflow.
- `/account/verification` shows the signed-in customer's verification tier and request status. Vendor verification is available from **Store Settings**.
- `DELIVERY_PARTNER` accounts are created by an administrator and can be assigned to paid escrow orders from **Delivery & riders**. Vendors mark packages as shipped; only the assigned rider can advance delivery from `PENDING` to `PICKED_UP` to `DELIVERED`.

Backend role checks protect the vendor and admin APIs independently of the frontend route guards. Suspended accounts are denied sign-in and their existing bearer tokens are rejected by authenticated API routes.

### Tier 1 and Tier 2 verification

New vendors start at Tier 1 and must complete the `/api/vendor/verify-tier1` soft-check before creating or listing products. The check requires a full legal name, 11-digit NIN format, active Nigerian bank, and 10-digit payout account number. Paystack's bank account resolution API must return an account-holder name matching the supplied legal name (name tokens are compared case-insensitively and without punctuation). NIN is only format-checked; it is **not** validated against NIMC records. The API stores NIN and account number encrypted with AES-256-GCM, and exposes only their last four digits in vendor profile responses. The identity timestamp represents completion of this soft-check, not an authoritative NIN verification. Configure `PAYSTACK_SECRET_KEY` to enable bank lookup.

Tier 2 remains a separate manual review: submitting a legal name, identity-document type, and one PDF/JPEG/PNG document (up to 5 MB) creates a Tier 2 review request; it does not mark the account as verified. Documents are encrypted in the application with AES-256-GCM before being stored in MongoDB. Only an authenticated admin can download a document while its request is pending. The encrypted document is deleted in the same transaction that records the admin's approval or rejection. Checkout verifies the account's stored Tier 2 approval on the server and does not trust a browser-supplied verification flag. Tier 2 approval also permits listing if the vendor has not completed the Tier 1 soft-check.

Set `VERIFICATION_DOCUMENT_ENCRYPTION_KEY` to a persistent, randomly generated 32-byte key encoded as 64 hexadecimal characters. Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and keep it only in the deployment secret store (for example `k8s/secrets.env` before creating the Kubernetes secret). Do not commit it. The same key must remain available while documents and Tier 1 encrypted identifiers are needed; clear pending review documents before rotating it, and migrate/re-encrypt vendor identifiers before rotating it. Admin document downloads are attachment-only, non-cacheable responses. Uploaded identity files must still be checked by staff through the organization's approved identity-verification process; this application does not independently validate BVN/NIN records or provide automated KYC.

### Vendor fees, limits, receipts, and escrow release

The backend is authoritative for order prices, quantities, vendor tiers, transaction caps, and fees. Tier 1 vendors are limited to **₦100,000 per order** and **₦500,000 in daily gross sales** with a **10% vendor commission**. Approved Tier 2 vendors have a **₦1,000,000 per-order** and **₦5,000,000 daily** cap and a **5% commission**. All new vendors start at Tier 1. The buyer escrow fee remains **2.5% of the server-calculated order subtotal**. These defaults are defined in `backend/services/financialPolicy.js`.

The checkout API creates an expiring payment order from current database prices and stock, not client-supplied amounts. A successful Paystack verification or signed webhook locks funds and decrements inventory. If payment arrives after the order hold expires or its inventory is no longer available, the order is flagged for admin dispute review rather than silently treated as a successful checkout.

Vendors can mark their fulfillment `PENDING` → `PROCESSING` → `SHIPPED`. The assigned rider then confirms pickup and delivery. A buyer can finalize the receipt and release only after rider delivery is confirmed. The finalization stores an itemized receipt with subtotal, escrow fee, each vendor's tier and commission, net payout, total paid, and escrow status. Buyers can view and download it from **My Orders**. Released vendor amounts are credited to the internal NGN wallet ledger; this project does **not** initiate bank payouts or provide a payout-request endpoint. Tier 1 verification stores a payout account for future provider integration only.

Wallet credits, stock changes, and identity-document submission/review use MongoDB transactions. Run against a MongoDB replica set (including MongoDB Atlas) for payment confirmation and settlement. Configure an actual payout provider and reconciliation process before representing wallet balances as withdrawn funds.

An administrator's **Refund** dispute decision records the refund outcome and creates the corresponding receipt, but does not call Paystack's refund API. Complete and reconcile the gateway refund in Paystack before using that resolution in production.

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
