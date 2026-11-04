import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { io } from "socket.io-client";
import { BACKEND_BASE_URL, getApiErrorMessage, getAssetUrl } from "../api";
import { productsService } from "../services/productsService";
import "./ProductList.css";

// eslint-disable-next-line react/prop-types
export default function ProductList({ onAddToCart }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState("");
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [featuredError, setFeaturedError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    productsService
      .list({ signal: controller.signal })
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error("The marketplace API returned an invalid product list.");
        }
        setProducts(data);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, "Failed to fetch products."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const socket = io(BACKEND_BASE_URL, { transports: ["websocket", "polling"] });
    const refreshFeatured = () => {
      productsService
        .featured()
        .then((items) => {
          setFeaturedProducts(items);
          setFeaturedError("");
        })
        .catch((loadError) => {
          setFeaturedError(getApiErrorMessage(loadError, "Featured listings could not be refreshed."));
        });
    };
    socket.on("product:updated", (update) => {
      setProducts((current) =>
        current.map((product) =>
          (product.id || product._id) === update.id
            ? {
                ...product,
                currentPrice: update.currentPrice,
                price: update.currentPrice,
                stock: update.stock,
              }
            : product,
        ),
      );
    });
    socket.on("featured:updated", refreshFeatured);
    refreshFeatured();
    return () => socket.disconnect();
  }, []);

  const searchSemantically = async () => {
    if (!search.trim()) {
      setSemanticResults(null);
      setSemanticError("");
      return;
    }
    setSemanticLoading(true);
    setSemanticError("");
    try {
      const results = await productsService.semanticSearch(search.trim());
      setSemanticResults(results);
    } catch (searchError) {
      setSemanticError(getApiErrorMessage(searchError, "Semantic search is unavailable."));
    } finally {
      setSemanticLoading(false);
    }
  };

  const categories = useMemo(
    () => [
      "All",
      ...new Set(
        products
          .map((product) => product.category?.trim())
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right)),
      ),
    ],
    [products],
  );

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (semanticResults || products).filter((product) => {
      const matchesCategory =
        selectedCategory === "All" ||
        product.category?.trim() === selectedCategory;
      const searchableText = [
        product.name,
        product.title,
        product.description,
        product.category,
        product.vendor,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesCategory &&
        (semanticResults || searchableText.includes(normalizedSearch));
    });
  }, [products, semanticResults, search, selectedCategory]);

  if (loading) {
    return (
      <div className="marketplace-state" role="status">
        Loading marketplace products...
      </div>
    );
  }

  if (error) {
    return (
      <section className="marketplace-state marketplace-state--error" role="alert">
        <h1>Marketplace unavailable</h1>
        <p>{error}</p>
        <p>Check that the configured marketplace API is available.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="marketplace-title" className="marketplace">
      <header className="marketplace__hero">
        <p className="marketplace__eyebrow">DISCOVER INDEPENDENT STORES</p>
        <h1 id="marketplace-title">Good finds, from sellers worth knowing.</h1>
        <p>
          Explore products from independent vendors, find your next favorite,
          and shop directly from their stores.
        </p>
        <label className="marketplace__search">
          <Search aria-hidden="true" size={19} />
          <span className="marketplace__sr-only">Search products and stores</span>
          <input
            onChange={(event) => {
              setSearch(event.target.value);
              setSemanticResults(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchSemantically();
              }
            }}
            placeholder="Search products, categories, or stores"
            type="search"
            value={search}
          />
        </label>
        <button
          className="marketplace__semantic-search"
          disabled={semanticLoading || !search.trim()}
          onClick={() => void searchSemantically()}
          type="button"
        >
          {semanticLoading ? "Finding matches..." : "Search by meaning"}
        </button>
        {semanticError && <p className="marketplace__search-error" role="status">{semanticError}</p>}
      </header>

      {featuredProducts.length > 0 && (
        <section aria-labelledby="marketplace-featured-title" className="marketplace-featured">
          <div className="marketplace__section-heading">
            <div>
              <p className="marketplace__eyebrow">HANDPICKED FOR YOU</p>
              <h2 id="marketplace-featured-title">Featured Vendors &amp; Top Deals</h2>
            </div>
          </div>
          {featuredError && <p className="marketplace__search-error" role="status">{featuredError}</p>}
          <div className="marketplace-featured__items">
            {featuredProducts.map((product) => (
              <Link
                className="marketplace-featured__item"
                key={product.id || product._id}
                to={`/store/${encodeURIComponent(product.vendorId)}`}
              >
                {product.imageUrl && <img alt="" loading="lazy" src={getAssetUrl(product.imageUrl)} />}
                <span>
                  <strong>{product.title || product.name}</strong>
                  <small>{product.vendor} · ₦{Number(product.price ?? product.currentPrice).toLocaleString()}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="marketplace__section-heading">
        <div>
          <p className="marketplace__eyebrow">THE MARKETPLACE</p>
          <h2>Explore products</h2>
        </div>
        <span>{filteredProducts.length} products</span>
      </div>

      <nav aria-label="Filter products by category" className="marketplace__categories">
        {categories.map((category) => (
          <button
            aria-pressed={selectedCategory === category}
            className={
              selectedCategory === category
                ? "marketplace__category marketplace__category--active"
                : "marketplace__category"
            }
            key={category}
            onClick={() => setSelectedCategory(category)}
            type="button"
          >
            {category}
          </button>
        ))}
      </nav>

      {filteredProducts.length === 0 ? (
        <div className="marketplace__empty">
          <h3>{products.length ? "No matching products" : "The shelves are being stocked"}</h3>
          <p>
            {products.length
              ? "Try another search or category."
              : "Check back soon to discover products from our vendors."}
          </p>
          {(search || selectedCategory !== "All") && (
            <button
              className="marketplace__reset"
              onClick={() => {
                setSearch("");
                setSelectedCategory("All");
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="marketplace__grid">
          {filteredProducts.map((product) => (
            <article className="marketplace-card" key={product.id || product._id}>
              <div className="marketplace-card__image">
                {product.imageUrl || product.image ? (
                  <img
                    alt={product.name || product.title || "Marketplace product"}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                    src={getAssetUrl(product.imageUrl || product.image)}
                  />
                ) : (
                  <div
                    aria-label={`${product.name || product.title || "Product"} image`}
                    className="marketplace-card__image-placeholder"
                    role="img"
                  >
                    {product.category || "Marketplace"}
                  </div>
                )}
                <span>{product.category || "Featured"}</span>
              </div>
              <div className="marketplace-card__body">
                <h3>{product.name || product.title}</h3>
                {product.vendorId ? (
                  <Link
                    className="marketplace-card__vendor"
                    to={`/store/${encodeURIComponent(product.vendorId)}`}
                  >
                    {product.vendor || "Visit vendor store"}
                  </Link>
                ) : (
                  <span className="marketplace-card__vendor">
                    {product.vendor || "Marketplace seller"}
                  </span>
                )}
                <span
                  className={`marketplace-card__tier-badge${product.vendorTier === "TIER_2" && product.isVerifiedVendor ? " marketplace-card__tier-badge--verified" : ""}`}
                >
                  {product.vendorTier === "TIER_2" && product.isVerifiedVendor
                    ? "Tier 2 Verified Vendor"
                    : "Tier 1 Vendor"}
                </span>
                <div className="marketplace-card__pricing">
                  <p className="marketplace-card__price-before">
                    Before Price{" "}
                    <s>
                      ₦{(Number(product.basePrice) || 0).toLocaleString()}
                    </s>
                  </p>
                  <p className="marketplace-card__price">
                    After Price{" "}
                    <strong>
                      ₦
                      {(
                        Number(product.price ?? product.currentPrice) || 0
                      ).toLocaleString()}
                    </strong>
                  </p>
                </div>
                <div className="marketplace-card__actions">
                  {product.vendorId ? (
                    <Link
                      className="marketplace-card__store"
                      to={`/store/${encodeURIComponent(product.vendorId)}`}
                    >
                      Visit store
                    </Link>
                  ) : (
                    <span className="marketplace-card__store marketplace-card__store--disabled">
                      Store details unavailable
                    </span>
                  )}
                  <button
                    className="marketplace-card__add"
                    onClick={() => onAddToCart(product)}
                    type="button"
                  >
                    Add to cart
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
