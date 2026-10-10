import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { pricingService } from "../services/pricingService";
import { productsService } from "../services/productsService";
import "./VendorDashboard.css";

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const toDraft = (product) => ({
  basePrice: String(product.basePrice ?? ""),
  demandScore: String(product.demandScore ?? 0),
  stock: String(product.stock ?? 0),
  competitorPrice: String(product.competitorPrice ?? ""),
  priceFloor: String(product.priceFloor ?? ""),
  priceCeiling: String(product.priceCeiling ?? ""),
});

const validateDraft = (draft) => {
  const basePrice = Number(draft.basePrice);
  const demandScore = Number(draft.demandScore);
  const stock = Number(draft.stock);
  const priceFloor = Number(draft.priceFloor);
  const priceCeiling = Number(draft.priceCeiling);
  const competitorPrice =
    draft.competitorPrice.trim() === ""
      ? null
      : Number(draft.competitorPrice);

  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return "Base price must be a positive number.";
  }
  if (
    !Number.isFinite(demandScore) ||
    demandScore < 0 ||
    demandScore > 100
  ) {
    return "Demand score must be between 0 and 100.";
  }
  if (!Number.isInteger(stock) || stock < 0) {
    return "Stock must be a non-negative whole number.";
  }
  if (!Number.isFinite(priceFloor) || priceFloor <= 0) {
    return "Price floor must be a positive number.";
  }
  if (
    !Number.isFinite(priceCeiling) ||
    priceCeiling <= 0 ||
    priceCeiling < priceFloor
  ) {
    return "Price ceiling must be greater than or equal to the price floor.";
  }
  if (
    competitorPrice !== null &&
    (!Number.isFinite(competitorPrice) || competitorPrice <= 0)
  ) {
    return "Competitor price must be a positive number, or leave it blank.";
  }

  return null;
};

export default function VendorDashboard({ onPriceUpdated }) {
  const [products, setProducts] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [results, setResults] = useState({});
  const [productErrors, setProductErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingProductId, setPendingProductId] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      setLoading(true);
      setLoadError("");

      try {
        const vendorProducts = await productsService.listMine({
          signal: controller.signal,
        });
        if (!Array.isArray(vendorProducts)) {
          throw new Error("The products API returned an invalid product list.");
        }
        if (
          vendorProducts.some(
            (product) =>
              !product ||
              typeof product._id !== "string" ||
              typeof product.title !== "string" ||
              ![
                product.basePrice,
                product.currentPrice,
                product.demandScore,
                product.stock,
                product.priceFloor,
                product.priceCeiling,
              ].every(Number.isFinite),
          )
        ) {
          throw new Error("The products API returned invalid product data.");
        }

        setProducts(vendorProducts);
        setDrafts(
          Object.fromEntries(
            vendorProducts.map((product) => [
              product._id,
              toDraft(product),
            ]),
          ),
        );
        setResults({});
        setProductErrors({});
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(
            getApiErrorMessage(error, "Unable to load your products."),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadProducts();
    return () => controller.abort();
  }, [refreshVersion]);

  const updateDraft = (productId, field, value) => {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [productId]: { ...currentDrafts[productId], [field]: value },
    }));
    setProductErrors((currentErrors) => ({
      ...currentErrors,
      [productId]: "",
    }));
    setResults((currentResults) => ({
      ...currentResults,
      [productId]: null,
    }));
  };

  const recalculatePrice = async (event, product) => {
    event.preventDefault();
    const productId = product._id;
    const draft = drafts[productId];
    const validationError = validateDraft(draft);
    if (validationError) {
      setProductErrors((currentErrors) => ({
        ...currentErrors,
        [productId]: validationError,
      }));
      return;
    }

    setPendingProductId(productId);
    setProductErrors((currentErrors) => ({ ...currentErrors, [productId]: "" }));
    setResults((currentResults) => ({ ...currentResults, [productId]: null }));

    try {
      const result = await pricingService.calculatePrice({
        productId,
        basePrice: Number(draft.basePrice),
        demandScore: Number(draft.demandScore),
        stock: Number(draft.stock),
        competitorPrice:
          draft.competitorPrice.trim() === ""
            ? null
            : Number(draft.competitorPrice),
        priceFloor: Number(draft.priceFloor),
        priceCeiling: Number(draft.priceCeiling),
      });

      if (
        !result?.success ||
        !Number.isFinite(result.currentPrice) ||
        !Number.isFinite(result.referencePrice) ||
        !Number.isFinite(result.priceFloor) ||
        !Number.isFinite(result.priceCeiling) ||
        !["FLOOR", "CEILING", "WITHIN_RANGE"].includes(
          result.floorCeilingStatus,
        ) ||
        !result.adjustments ||
        !Number.isFinite(result.adjustments.demandPercent) ||
        !Number.isFinite(result.adjustments.stockPercent) ||
        typeof result.adjustments.competitorPriceApplied !== "boolean"
      ) {
        throw new Error("The pricing API returned an invalid calculation.");
      }

      setProducts((currentProducts) =>
        currentProducts.map((currentProduct) =>
          currentProduct._id === productId
            ? {
                ...currentProduct,
                currentPrice: result.currentPrice,
                competitorPrice: result.competitorPrice,
              }
            : currentProduct,
        ),
      );
      setResults((currentResults) => ({
        ...currentResults,
        [productId]: result,
      }));
      onPriceUpdated?.(result);
    } catch (error) {
      setProductErrors((currentErrors) => ({
        ...currentErrors,
        [productId]: getApiErrorMessage(
          error,
          "Unable to recalculate this product's price.",
        ),
      }));
    } finally {
      setPendingProductId(null);
    }
  };

  return (
    <section
      aria-labelledby="vendor-pricing-title"
      className="vendor-pricing"
    >
      <header className="vendor-pricing__header">
        <div>
          <p className="vendor-pricing__eyebrow">VENDOR TOOLS</p>
          <h1 id="vendor-pricing-title">Dynamic pricing</h1>
          <p className="vendor-pricing__description">
            Adjust product pricing inputs, then recalculate within your price
            floor and ceiling. Recalculation saves all edited values.
          </p>
        </div>
        <button
          aria-label="Refresh vendor products"
          className="vendor-pricing__refresh"
          disabled={loading || pendingProductId !== null}
          onClick={() => setRefreshVersion((version) => version + 1)}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={loading ? "vendor-pricing__spinning" : ""}
            size={16}
          />
          Refresh products
        </button>
      </header>

      {loadError && (
        <div className="vendor-pricing__message vendor-pricing__message--error" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <p className="vendor-pricing__empty" role="status">
          Loading your products...
        </p>
      ) : loadError ? null : products.length === 0 ? (
        <p className="vendor-pricing__empty">
          No vendor products are available to price yet.
        </p>
      ) : (
        <div className="vendor-pricing__products">
          {products.map((product) => {
            const productId = product._id;
            const draft = drafts[productId];
            const result = results[productId];
            const error = productErrors[productId];
            const isPending = pendingProductId === productId;

            return (
              <article
                className="vendor-pricing__card"
                key={productId}
                aria-labelledby={`vendor-product-${productId}`}
              >
                <header className="vendor-pricing__product-header">
                  <div>
                    <h2 id={`vendor-product-${productId}`}>
                      {product.title || product.name || "Untitled product"}
                    </h2>
                    <p>
                      Current price:{" "}
                      <strong>
                        {Number.isFinite(product.currentPrice)
                          ? currencyFormatter.format(product.currentPrice)
                          : "Not set"}
                      </strong>
                    </p>
                  </div>
                  {result && (
                    <span
                      className={`vendor-pricing__status vendor-pricing__status--${result.floorCeilingStatus?.toLowerCase()}`}
                    >
                      {result.floorCeilingStatus === "WITHIN_RANGE"
                        ? "Within range"
                        : result.floorCeilingStatus === "FLOOR"
                          ? "Floor applied"
                          : "Ceiling applied"}
                    </span>
                  )}
                </header>

                <form
                  className="vendor-pricing__form"
                  onSubmit={(event) => recalculatePrice(event, product)}
                >
                  <label className="vendor-pricing__field">
                    <span>Base price (₦)</span>
                    <input
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) =>
                        updateDraft(productId, "basePrice", event.target.value)
                      }
                      required
                      step="0.01"
                      type="number"
                      value={draft.basePrice}
                    />
                  </label>

                  <label className="vendor-pricing__field vendor-pricing__field--demand">
                    <span>
                      Demand score <strong>{draft.demandScore}</strong>
                    </span>
                    <input
                      max="100"
                      min="0"
                      onChange={(event) =>
                        updateDraft(
                          productId,
                          "demandScore",
                          event.target.value,
                        )
                      }
                      type="range"
                      value={draft.demandScore}
                    />
                    <input
                      aria-label="Demand score from 0 to 100"
                      max="100"
                      min="0"
                      onChange={(event) =>
                        updateDraft(
                          productId,
                          "demandScore",
                          event.target.value,
                        )
                      }
                      required
                      step="1"
                      type="number"
                      value={draft.demandScore}
                    />
                  </label>

                  <label className="vendor-pricing__field">
                    <span>Stock quantity</span>
                    <input
                      min="0"
                      onChange={(event) =>
                        updateDraft(productId, "stock", event.target.value)
                      }
                      required
                      step="1"
                      type="number"
                      value={draft.stock}
                    />
                  </label>

                  <label className="vendor-pricing__field">
                    <span>Competitor price (₦, optional)</span>
                    <input
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) =>
                        updateDraft(
                          productId,
                          "competitorPrice",
                          event.target.value,
                        )
                      }
                      placeholder="No competitor reference"
                      step="0.01"
                      type="number"
                      value={draft.competitorPrice}
                    />
                  </label>

                  <label className="vendor-pricing__field">
                    <span>Price floor (₦)</span>
                    <input
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) =>
                        updateDraft(productId, "priceFloor", event.target.value)
                      }
                      required
                      step="0.01"
                      type="number"
                      value={draft.priceFloor}
                    />
                  </label>

                  <label className="vendor-pricing__field">
                    <span>Price ceiling (₦)</span>
                    <input
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) =>
                        updateDraft(
                          productId,
                          "priceCeiling",
                          event.target.value,
                        )
                      }
                      required
                      step="0.01"
                      type="number"
                      value={draft.priceCeiling}
                    />
                  </label>

                  {error && (
                    <div
                      className="vendor-pricing__message vendor-pricing__message--error vendor-pricing__form-message"
                      role="alert"
                    >
                      <AlertCircle aria-hidden="true" size={18} />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    className="vendor-pricing__calculate"
                    disabled={pendingProductId !== null}
                    type="submit"
                  >
                    {isPending ? "Recalculating..." : "Recalculate price"}
                  </button>
                </form>

                {result && (
                  <section
                    aria-label={`Calculation result for ${product.title || "product"}`}
                    className="vendor-pricing__result"
                    role="status"
                  >
                    <div className="vendor-pricing__result-price">
                      <CheckCircle2 aria-hidden="true" size={20} />
                      <span>Calculated price</span>
                      <strong>
                        {currencyFormatter.format(result.currentPrice)}
                      </strong>
                    </div>
                    <dl>
                      <div>
                        <dt>Reference price</dt>
                        <dd>
                          {currencyFormatter.format(result.referencePrice)}
                          {result.adjustments.competitorPriceApplied
                            ? " (competitor price applied)"
                            : " (base price)"}
                        </dd>
                      </div>
                      <div>
                        <dt>Demand adjustment</dt>
                        <dd>
                          {result.adjustments.demandPercent > 0 ? "+" : ""}
                          {result.adjustments.demandPercent}%
                        </dd>
                      </div>
                      <div>
                        <dt>Stock adjustment</dt>
                        <dd>
                          {result.adjustments.stockPercent > 0 ? "+" : ""}
                          {result.adjustments.stockPercent}%
                        </dd>
                      </div>
                      <div>
                        <dt>Price bounds</dt>
                        <dd>
                          {currencyFormatter.format(result.priceFloor)} –{" "}
                          {currencyFormatter.format(result.priceCeiling)}
                        </dd>
                      </div>
                    </dl>
                    <p className="vendor-pricing__result-status">
                      {result.floorCeilingStatus === "WITHIN_RANGE"
                        ? "Calculated price is within the allowed range."
                        : result.floorCeilingStatus === "FLOOR"
                          ? "Calculated price was raised to the configured floor."
                          : "Calculated price was lowered to the configured ceiling."}
                    </p>
                  </section>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

VendorDashboard.propTypes = {
  onPriceUpdated: PropTypes.func,
};
