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

### Vendor tiers, recurring billing, and verification

Vendor subscriptions are Tier 1 Basic ($5/month) and Tier 2 Verified ($10/month). Paystack charges the NGN equivalent using `VENDOR_TIER_USD_NGN_RATE`, a numeric NGN-per-USD rate configured by the operator. Configure `PAYSTACK_SECRET_KEY` on the backend and `VITE_PAYSTACK_PUBLIC_KEY` in the frontend. The backend creates monthly Paystack plans and verifies the first charge; signed Paystack subscription and invoice webhooks update renewals and failed-payment status. Configure Paystack to deliver `subscription.create`, `subscription.disable`, `subscription.not_renew`, `invoice.payment_failed`, and `invoice.update` events to `/api/webhooks/paystack`. Failed renewal moves the seller to `PAST_DUE`; the recorded subscription-period end also stops marketplace eligibility if a renewal event is missed.

Tier 1 sellers still submit their full legal name and an 11-digit NIN; the NIN is format-checked only and is **not** validated against NIMC records. Tier 2 sellers submit their legal name, a NIN/BVN/passport/Voter's Card image or PDF, and a payout bank account. The Tier 2 verified badge and Tier 2 financial limits require both an active monthly plan and approved identity review. Paystack's bank account resolution API must return an account-holder name matching the supplied legal name (name tokens are compared case-insensitively and without punctuation). NIN identifiers, payout account numbers, and identity documents are encrypted with AES-256-GCM; API responses expose only masked payout account details.

Tier 2 sellers submit a legal name, identity-document type, and one PDF/JPEG/PNG document (up to 5 MB) for manual admin review. Documents are encrypted in the application with AES-256-GCM before being stored in MongoDB. Only an authenticated admin can download a document while its request is pending. Tier 2 listing and the “Tier 2 Verified Vendor” badge require both an active monthly Tier 2 plan and approved identity review. Tier 1 sellers receive a “Tier 1 Vendor” badge after their active plan and soft-check are complete. Product listing, public storefronts, and checkout enforce the selected active plan and its verification requirements on the server.

Set `VERIFICATION_DOCUMENT_ENCRYPTION_KEY` to a persistent, randomly generated 32-byte key encoded as 64 hexadecimal characters. Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and keep it only in the deployment secret store (for example `k8s/secrets.env` before creating the Kubernetes secret). Do not commit it. The same key must remain available while documents and Tier 1 encrypted identifiers are needed; clear pending review documents before rotating it, and migrate/re-encrypt vendor identifiers before rotating it. Admin document downloads are attachment-only, non-cacheable responses. Uploaded identity files must still be checked by staff through the organization's approved identity-verification process; this application does not independently validate BVN/NIN records or provide automated KYC.

### Vendor fees, limits, receipts, and escrow release

The backend is authoritative for order prices, quantities, vendor tiers, transaction caps, and fees. Prices are adjusted using seller demand, stock thresholds, and units ordered in the previous 24 hours, then rounded to two decimals and clamped to each seller's price floor and ceiling. Twenty percent of any positive stock/order-driven price uplift is withheld as a demand-surge platform share and recorded in the admin commission ledger. It remains pending until escrow release and is reversed on refund. Tier 1 vendors are limited to **₦100,000 per order** and **₦500,000 in daily gross sales** with a **10% vendor commission**. Tier 2 vendors with approved identity review have a **₦1,000,000 per-order** and **₦5,000,000 daily** cap and a **5% commission**. The buyer escrow fee remains **2.5% of the server-calculated order subtotal**. These policies are defined in `backend/services/financialPolicy.js`.

The public storefront uses Socket.io to broadcast committed price/stock updates and featured-listing changes. Gemini features require `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) on the backend; `GEMINI_CHAT_MODEL` optionally overrides the support-chat model. `POST /api/products/search/semantic` uses Gemini embeddings and caches product vectors in MongoDB; `POST /api/ai/support` provides policy-guided customer support. Feature/unfeature vendors and products in the admin **Featured listings** section. Surge-share entries are available to administrators under **Commission ledger**.

The customer storefront and vendor storefront use one shared cart, so buyers can check out products from multiple eligible vendors in a single escrow order. The checkout API creates an expiring payment order from current database prices and stock, not client-supplied amounts. A successful Paystack verification or signed webhook locks funds and decrements inventory. If payment arrives after the order hold expires or its inventory is no longer available, the order is flagged for admin dispute review rather than silently treated as a successful checkout.

Vendors can mark their fulfillment `PENDING` → `PROCESSING` → `SHIPPED`. The assigned rider then confirms pickup and delivery. A buyer can finalize the receipt and release only after rider delivery is confirmed. The finalization stores an itemized receipt with subtotal, escrow fee, each vendor's tier and commission, net payout, total paid, and escrow status. Buyers can view and download it from **My Orders**. After successful checkout, each vendor's net proceeds (after commission) are credited to `pendingBalance`; buyer receipt confirmation moves those funds to `availableBalance`. Refunds remove the held proceeds rather than making them withdrawable. Vendors can withdraw their available balance through Paystack bank transfers. Tier 2 vendors use their verified saved payout account; Tier 1 vendors provide and soft-check a bank account when withdrawing.

Wallet credits, escrow releases/refunds, withdrawals, stock changes, and identity-document submission/review use MongoDB transactions. Run against a MongoDB replica set (including MongoDB Atlas). Paystack transfers require `PAYSTACK_SECRET_KEY`, sufficient NGN balance in the Paystack transfer source, and the Paystack webhook configured for `transfer.success`, `transfer.failed`, and `transfer.reversed` at `/api/webhooks/paystack`; unresolved transfers remain reserved until the provider event settles them.

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
It returns products marked `isApproved: true`, `status: "active"`, and
`isPublished: true`, without filtering by vendor subscription eligibility.
Demo product seed data is not run on server startup.

To publish the existing 40 product records, first run the guarded dry run and
then apply the update:

```sh
npm --prefix backend run publish:existing-products
npm --prefix backend run publish:existing-products -- --apply
```

The script refuses to write unless exactly 40 products are present, and checks
that all three publication flags were updated afterward.

### Seeding local marketplace demo data

To populate the marketplace with seven demo vendors and 35 products, configure
`MONGO_URI` (or `MONGODB_URI`) and run:

```sh
npm --prefix backend run seed:marketplace
```

The script is idempotent and refuses to run when `NODE_ENV=production`. It
creates eligible Tier 1/Tier 2 seller accounts, demo wallet balances, and
product images hosted by Unsplash. All seller accounts use the password
`DemoVendor123!`; their emails are `demo.vendor1@example.test` through
`demo.vendor7@example.test`. The NINs and 10-digit account numbers are
synthetic, encrypted test placeholders. Their bank codes are deliberately
non-production `TEST-*` values: these accounts are not real, have not passed
identity or bank verification, and cannot be used for Paystack payouts. Do not
use these accounts or credentials in a production environment.

If `VERIFICATION_DOCUMENT_ENCRYPTION_KEY` is not set, the development seeder
uses a fixed dummy test key for these synthetic records. Set a private
64-character hexadecimal key if you need to decrypt seeded values locally.
This fallback is limited to this seeder; it does not configure encryption for
the application or other flows.

To make an existing **local test seller** eligible to publish its inventory,
configure `MONGO_URI` (or `MONGODB_URI`) to a localhost MongoDB instance and
provide that seller's `.test` email:

```sh
npm --prefix backend run seed:verify-primary-vendor -- primary@example.test
```

The helper only accepts `.test` email accounts already registered as
non-suspended sellers and only connects to `localhost`, `127.0.0.1`, or `::1`.
It enables synthetic Tier 1 marketplace visibility for local development; it
does not validate identity, resolve a bank account, or satisfy real vendor
onboarding or payment requirements. It must not be used for production
approvals.
