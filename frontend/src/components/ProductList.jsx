import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { getApiErrorMessage, getAssetUrl } from "../api";
import { productsService } from "../services/productsService";
import "./ProductList.css";

// eslint-disable-next-line react/prop-types
export default function ProductList({ onAddToCart }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

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
    return products.filter((product) => {
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
      return matchesCategory && searchableText.includes(normalizedSearch);
    });
  }, [products, search, selectedCategory]);

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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products, categories, or stores"
            type="search"
            value={search}
          />
        </label>
      </header>

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
                <p className="marketplace-card__price">
                  ₦{(Number(product.price ?? product.currentPrice) || 0).toLocaleString()}
                </p>
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
