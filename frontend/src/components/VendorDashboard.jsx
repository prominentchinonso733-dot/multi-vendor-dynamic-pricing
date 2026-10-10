import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { authService } from "../services/authService";
import { pricingService } from "../services/pricingService";
import { productsService } from "../services/productsService";
import "./VendorDashboard.css";

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const initialProductDraft = {
  title: "",
  description: "",
  category: "",
  basePrice: "",
  demandScore: "50",
  stock: "0",
  competitorPrice: "",
  priceFloor: "",
  priceCeiling: "",
};

const emptyStoreProfile = {
  storeName: "",
  storeLogo: "",
  storeBanner: "",
  storeDescription: "",
};

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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDraft, setCreateDraft] = useState(initialProductDraft);
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [activeSection, setActiveSection] = useState("pricing");
  const [storeProfile, setStoreProfile] = useState(emptyStoreProfile);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");

  useEffect(() => {
    if (activeSection !== "store-settings") return undefined;

    const controller = new AbortController();
    async function loadStoreProfile() {
      setProfileLoading(true);
      setProfileError("");
      try {
        const profile = await authService.getStoreProfile({
          signal: controller.signal,
        });
        if (
          !profile ||
          ["storeName", "storeLogo", "storeBanner", "storeDescription"].some(
            (field) => typeof profile[field] !== "string",
          )
        ) {
          throw new Error("The profile API returned invalid store settings.");
        }
        setStoreProfile({
          storeName: profile.storeName,
          storeLogo: profile.storeLogo,
          storeBanner: profile.storeBanner,
          storeDescription: profile.storeDescription,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setProfileError(
            getApiErrorMessage(error, "Unable to load store settings."),
          );
        }
      } finally {
        if (!controller.signal.aborted) setProfileLoading(false);
      }
    }

    loadStoreProfile();
    return () => controller.abort();
  }, [activeSection]);

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

  const updateCreateDraft = (field, value) => {
    setCreateDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
    setCreateError("");
    setCreateNotice("");
  };

  const updateStoreProfileField = (field, value) => {
    setStoreProfile((currentProfile) => ({
      ...currentProfile,
      [field]: value,
    }));
    setProfileError("");
    setProfileNotice("");
  };

  const saveStoreProfile = async (event) => {
    event.preventDefault();
    setProfileError("");
    setProfileNotice("");

    const normalizedProfile = {
      storeName: storeProfile.storeName.trim(),
      storeLogo: storeProfile.storeLogo.trim(),
      storeBanner: storeProfile.storeBanner.trim(),
      storeDescription: storeProfile.storeDescription.trim(),
    };
    if (!normalizedProfile.storeName) {
      setProfileError("Store name is required.");
      return;
    }
    for (const [label, value] of [
      ["Logo", normalizedProfile.storeLogo],
      ["Banner", normalizedProfile.storeBanner],
    ]) {
      if (value) {
        try {
          const imageUrl = new URL(value);
          if (!["https:", "http:"].includes(imageUrl.protocol)) {
            throw new Error("unsupported protocol");
          }
        } catch {
          setProfileError(`${label} image must be a valid HTTP or HTTPS URL.`);
          return;
        }
      }
    }

    setProfileSaving(true);
    try {
      const savedProfile =
        await authService.updateStoreProfile(normalizedProfile);
      setStoreProfile({
        storeName: savedProfile.storeName,
        storeLogo: savedProfile.storeLogo,
        storeBanner: savedProfile.storeBanner,
        storeDescription: savedProfile.storeDescription,
      });
      setProfileNotice("Store settings saved successfully.");
    } catch (error) {
      setProfileError(
        getApiErrorMessage(error, "Unable to save store settings."),
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const createProduct = async (event) => {
    event.preventDefault();
    setCreateError("");
    setCreateNotice("");

    const basePrice = Number(createDraft.basePrice);
    const demandScore = Number(createDraft.demandScore);
    const stock = Number(createDraft.stock);
    const priceFloor = Number(createDraft.priceFloor);
    const priceCeiling = Number(createDraft.priceCeiling);
    const competitorPrice =
      createDraft.competitorPrice.trim() === ""
        ? null
        : Number(createDraft.competitorPrice);
    const validationError =
      !createDraft.title.trim()
        ? "Product title is required."
        : !Number.isFinite(basePrice) || basePrice <= 0
          ? "Base price must be a positive number."
          : !Number.isFinite(demandScore) ||
              demandScore < 0 ||
              demandScore > 100
            ? "Demand score must be between 0 and 100."
            : !Number.isInteger(stock) || stock < 0
              ? "Stock must be a non-negative whole number."
              : !Number.isFinite(priceFloor) || priceFloor <= 0
                ? "Price floor must be a positive number."
                : !Number.isFinite(priceCeiling) ||
                    priceCeiling <= 0 ||
                    priceCeiling < priceFloor
                  ? "Price ceiling must be greater than or equal to the price floor."
                  : competitorPrice !== null &&
                      (!Number.isFinite(competitorPrice) ||
                        competitorPrice <= 0)
                    ? "Competitor price must be a positive number, or leave it blank."
                    : null;

    if (validationError) {
      setCreateError(validationError);
      return;
    }

    setCreatePending(true);
    try {
      await productsService.create({
        title: createDraft.title.trim(),
        description: createDraft.description.trim(),
        category: createDraft.category.trim(),
        basePrice,
        demandScore,
        stock,
        competitorPrice,
        priceFloor,
        priceCeiling,
      });
      setCreateDraft(initialProductDraft);
      setShowCreateForm(false);
      setCreateNotice("Product created. It is now available in your pricing list.");
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setCreateError(
        getApiErrorMessage(error, "Unable to create this product."),
      );
    } finally {
      setCreatePending(false);
    }
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
        <button
          className="vendor-pricing__calculate"
          disabled={createPending || loading}
          onClick={() => {
            setShowCreateForm((visible) => !visible);
            setCreateError("");
            setCreateNotice("");
          }}
          type="button"
        >
          {showCreateForm ? "Cancel" : "Add product"}
        </button>
      </header>

      <nav aria-label="Vendor dashboard sections" className="vendor-pricing__tabs">
        <button
          aria-current={activeSection === "pricing" ? "page" : undefined}
          className={
            activeSection === "pricing"
              ? "vendor-pricing__tab vendor-pricing__tab--active"
              : "vendor-pricing__tab"
          }
          onClick={() => setActiveSection("pricing")}
          type="button"
        >
          Products & Pricing
        </button>
        <button
          aria-current={
            activeSection === "store-settings" ? "page" : undefined
          }
          className={
            activeSection === "store-settings"
              ? "vendor-pricing__tab vendor-pricing__tab--active"
              : "vendor-pricing__tab"
          }
          onClick={() => setActiveSection("store-settings")}
          type="button"
        >
          Store Settings
        </button>
      </nav>

      {activeSection === "pricing" ? (
        <>
      {createNotice && (
        <div
          className="vendor-pricing__message vendor-pricing__message--success"
          role="status"
        >
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>{createNotice}</span>
        </div>
      )}

      {showCreateForm && (
        <form
          className="vendor-pricing__create-form"
          onSubmit={createProduct}
        >
          <div className="vendor-pricing__create-heading">
            <div>
              <h2>Create a product</h2>
              <p>
                Set the product details and initial pricing limits. You can
                adjust them later.
              </p>
            </div>
          </div>
          <label className="vendor-pricing__field">
            <span>Product name</span>
            <input
              autoComplete="off"
              maxLength="160"
              onChange={(event) =>
                updateCreateDraft("title", event.target.value)
              }
              required
              value={createDraft.title}
            />
          </label>
          <label className="vendor-pricing__field">
            <span>Category (optional)</span>
            <input
              maxLength="80"
              onChange={(event) =>
                updateCreateDraft("category", event.target.value)
              }
              value={createDraft.category}
            />
          </label>
          <label className="vendor-pricing__field vendor-pricing__field--wide">
            <span>Description (optional)</span>
            <textarea
              maxLength="2000"
              onChange={(event) =>
                updateCreateDraft("description", event.target.value)
              }
              rows="3"
              value={createDraft.description}
            />
          </label>
          <label className="vendor-pricing__field">
            <span>Base price (₦)</span>
            <input
              min="0.01"
              onChange={(event) =>
                updateCreateDraft("basePrice", event.target.value)
              }
              required
              step="0.01"
              type="number"
              value={createDraft.basePrice}
            />
          </label>
          <label className="vendor-pricing__field vendor-pricing__field--demand">
            <span>
              Demand score <strong>{createDraft.demandScore}</strong>
            </span>
            <input
              aria-label="New product demand score from 0 to 100"
              max="100"
              min="0"
              onChange={(event) =>
                updateCreateDraft("demandScore", event.target.value)
              }
              type="range"
              value={createDraft.demandScore}
            />
            <input
              aria-label="New product demand score number from 0 to 100"
              max="100"
              min="0"
              onChange={(event) =>
                updateCreateDraft("demandScore", event.target.value)
              }
              required
              step="1"
              type="number"
              value={createDraft.demandScore}
            />
          </label>
          <label className="vendor-pricing__field">
            <span>Stock quantity</span>
            <input
              min="0"
              onChange={(event) =>
                updateCreateDraft("stock", event.target.value)
              }
              required
              step="1"
              type="number"
              value={createDraft.stock}
            />
          </label>
          <label className="vendor-pricing__field">
            <span>Competitor price (₦, optional)</span>
            <input
              min="0.01"
              onChange={(event) =>
                updateCreateDraft("competitorPrice", event.target.value)
              }
              step="0.01"
              type="number"
              value={createDraft.competitorPrice}
            />
          </label>
          <label className="vendor-pricing__field">
            <span>Price floor (₦)</span>
            <input
              min="0.01"
              onChange={(event) =>
                updateCreateDraft("priceFloor", event.target.value)
              }
              required
              step="0.01"
              type="number"
              value={createDraft.priceFloor}
            />
          </label>
          <label className="vendor-pricing__field">
            <span>Price ceiling (₦)</span>
            <input
              min="0.01"
              onChange={(event) =>
                updateCreateDraft("priceCeiling", event.target.value)
              }
              required
              step="0.01"
              type="number"
              value={createDraft.priceCeiling}
            />
          </label>

          {createError && (
            <div
              className="vendor-pricing__message vendor-pricing__message--error vendor-pricing__form-message"
              role="alert"
            >
              <AlertCircle aria-hidden="true" size={18} />
              <span>{createError}</span>
            </div>
          )}
          <button
            className="vendor-pricing__calculate vendor-pricing__create-submit"
            disabled={createPending}
            type="submit"
          >
            {createPending ? "Creating product..." : "Create product"}
          </button>
        </form>
      )}

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
        </>
      ) : (
        <section
          aria-labelledby="vendor-store-settings-title"
          className="vendor-pricing__settings"
        >
          <div className="vendor-pricing__settings-heading">
            <div>
              <p className="vendor-pricing__eyebrow">PUBLIC STORE PROFILE</p>
              <h2 id="vendor-store-settings-title">Store Settings</h2>
              <p>
                Customize the identity and appearance buyers see on your public
                storefront.
              </p>
            </div>
          </div>

          {profileError && (
            <div
              className="vendor-pricing__message vendor-pricing__message--error"
              role="alert"
            >
              <AlertCircle aria-hidden="true" size={18} />
              <span>{profileError}</span>
            </div>
          )}
          {profileNotice && (
            <div
              className="vendor-pricing__message vendor-pricing__message--success"
              role="status"
            >
              <CheckCircle2 aria-hidden="true" size={18} />
              <span>{profileNotice}</span>
            </div>
          )}

          {profileLoading ? (
            <p className="vendor-pricing__empty" role="status">
              Loading store settings...
            </p>
          ) : (
            <form
              className="vendor-pricing__settings-form"
              onSubmit={saveStoreProfile}
            >
              <label className="vendor-pricing__field">
                <span>Store name</span>
                <input
                  autoComplete="organization"
                  maxLength="100"
                  onChange={(event) =>
                    updateStoreProfileField("storeName", event.target.value)
                  }
                  required
                  value={storeProfile.storeName}
                />
              </label>
              <label className="vendor-pricing__field">
                <span>Store logo image URL</span>
                <input
                  maxLength="2048"
                  onChange={(event) =>
                    updateStoreProfileField("storeLogo", event.target.value)
                  }
                  placeholder="https://example.com/logo.png"
                  type="url"
                  value={storeProfile.storeLogo}
                />
              </label>
              <label className="vendor-pricing__field vendor-pricing__field--wide">
                <span>Store banner image URL</span>
                <input
                  maxLength="2048"
                  onChange={(event) =>
                    updateStoreProfileField("storeBanner", event.target.value)
                  }
                  placeholder="https://example.com/banner.jpg"
                  type="url"
                  value={storeProfile.storeBanner}
                />
              </label>
              <label className="vendor-pricing__field vendor-pricing__field--wide">
                <span>Store description</span>
                <textarea
                  maxLength="1000"
                  onChange={(event) =>
                    updateStoreProfileField(
                      "storeDescription",
                      event.target.value,
                    )
                  }
                  placeholder="Tell buyers what your store specializes in."
                  rows="5"
                  value={storeProfile.storeDescription}
                />
              </label>

              {(storeProfile.storeBanner || storeProfile.storeLogo) && (
                <div
                  aria-label="Store image preview"
                  className="vendor-pricing__image-preview vendor-pricing__field--wide"
                >
                  {storeProfile.storeBanner && (
                    <img
                      alt="Store banner preview"
                      className="vendor-pricing__banner-preview"
                      src={storeProfile.storeBanner}
                    />
                  )}
                  {storeProfile.storeLogo && (
                    <img
                      alt="Store logo preview"
                      className="vendor-pricing__logo-preview"
                      src={storeProfile.storeLogo}
                    />
                  )}
                </div>
              )}

              <button
                className="vendor-pricing__calculate vendor-pricing__create-submit"
                disabled={profileSaving}
                type="submit"
              >
                {profileSaving ? "Saving settings..." : "Save Store Settings"}
              </button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}

VendorDashboard.propTypes = {
  onPriceUpdated: PropTypes.func,
};
