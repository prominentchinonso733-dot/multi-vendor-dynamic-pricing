# Multi-Vendor Marketplace with Dynamic Pricing

A modern web application that enables multiple vendors to list and sell products while leveraging automated, algorithmic dynamic pricing to maximize revenue and keep prices competitive.

## Core Features
- **Automated Dynamic Pricing Engine:** Adjusts prices based on demand spikes, inventory levels, and competitor rates.
- **Multi-Vendor Management:** Dashboard for sellers to onboard, set price guardrails (floors/ceilings), and manage stock.
- **Unified Shopping & Checkout:** Customer portal with real-time price updates and single cart checkout.
- **Admin Control Panel:** Platform operator dashboard to manage vendors and track commission payouts.

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

To reassign all existing products to an account, configure `MONGO_URI`
and run `npm --prefix backend run reassign:products -- <USER_ID>
--confirm-reassign-all`. The command only proceeds when the ID belongs to an
existing account with the `SELLER` or `ADMIN` role. This operation transfers
ownership of every existing product document, including products currently
assigned to other sellers.

Run `npm --prefix backend run seed:sample-products` to idempotently insert the
four example marketplace products for `prominentchinonso733@gmail.com`. The
public `GET /api/products` endpoint reads product documents from MongoDB.
