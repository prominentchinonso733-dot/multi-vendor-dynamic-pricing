import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, BadgeCheck, Store } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { productsService } from "../services/productsService";
import "./VendorStorefront.css";

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
});

export default function VendorStorefront({ onAddToCart }) {
  const { vendorId } = useParams();
  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadStore() {
      setLoading(true);
      setError("");
      setStore(null);
      setProducts([]);

      try {
        const data = await productsService.getStore(vendorId, {
          signal: controller.signal,
        });
        if (
          !data?.success ||
          !data.vendor ||
          data.vendor.id !== vendorId ||
          !Array.isArray(data.products) ||
          data.products.some(
            (product) =>
              product.vendorId !== vendorId ||
              typeof product.name !== "string" ||
              !Number.isFinite(product.price),
          )
        ) {
          throw new Error("The storefront API returned invalid store data.");
        }

        setStore(data.vendor);
        setProducts(data.products);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            getApiErrorMessage(loadError, "Unable to load this vendor store."),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadStore();
    return () => controller.abort();
  }, [vendorId]);

  if (loading) {
    return (
      <div className="vendor-store__message" role="status">
        Loading vendor store...
      </div>
    );
  }

  if (error) {
    return (
      <section className="vendor-store">
        <Link className="vendor-store__back" to="/">
          Back to marketplace
        </Link>
        <div
          className="vendor-store__message vendor-store__message--error"
          role="alert"
        >
          <AlertCircle aria-hidden="true" size={20} />
          <span>{error}</span>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="vendor-store-title" className="vendor-store">
      <Link className="vendor-store__back" to="/">
        Back to marketplace
      </Link>

      <header className="vendor-store__header">
        <div className="vendor-store__identity">
          <div className="vendor-store__icon" aria-hidden="true">
            <Store size={28} />
          </div>
          <div>
            <p className="vendor-store__eyebrow">VENDOR STORE</p>
            <h1 id="vendor-store-title">{store.storeName}</h1>
            <p className="vendor-store__owner">
              Store owner: <strong>{store.name}</strong>
              {store.isVerified && (
                <span className="vendor-store__verified">
                  <BadgeCheck aria-hidden="true" size={16} />
                  Verified
                </span>
              )}
            </p>
          </div>
        </div>

        <dl className="vendor-store__details">
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${store.email}`}>{store.email}</a>
            </dd>
          </div>
          {store.tier && (
            <div>
              <dt>Vendor tier</dt>
              <dd>{store.tier.replaceAll("_", " ")}</dd>
            </div>
          )}
          {store.memberSince && (
            <div>
              <dt>Member since</dt>
              <dd>{dateFormatter.format(new Date(store.memberSince))}</dd>
            </div>
          )}
          <div>
            <dt>Products</dt>
            <dd>{products.length}</dd>
          </div>
        </dl>
      </header>

      <div className="vendor-store__section-heading">
        <div>
          <p className="vendor-store__eyebrow">SHOP THIS STORE</p>
          <h2>Products from {store.storeName}</h2>
        </div>
      </div>

      {products.length === 0 ? (
        <p className="vendor-store__empty">
          This store has no listed products yet.
        </p>
      ) : (
        <div className="vendor-store__products">
          {products.map((product) => (
            <article className="vendor-store__product" key={product.id}>
              {product.image ? (
                <img src={product.image} alt="" loading="lazy" />
              ) : (
                <div className="vendor-store__image-placeholder">
                  <Store aria-hidden="true" size={28} />
                </div>
              )}
              <div className="vendor-store__product-content">
                <p className="vendor-store__category">
                  {product.category || "Marketplace"}
                </p>
                <h3>{product.name}</h3>
                {product.description && <p>{product.description}</p>}
                <strong>{currencyFormatter.format(product.price)}</strong>
                <button
                  className="vendor-store__add-button"
                  onClick={() => onAddToCart(product)}
                  type="button"
                >
                  Add to Cart
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

VendorStorefront.propTypes = {
  onAddToCart: PropTypes.func.isRequired,
};
