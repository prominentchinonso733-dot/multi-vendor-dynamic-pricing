import React, { useState, useEffect } from "react";
import { API_BASE_URL } from "../api";

const ProductList = ({ onAddToCart }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/products`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch products from backend");
        }
        return res.json();
      })
      .then((data) => {
        setProducts(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "3rem",
          fontSize: "1.2rem",
          color: "#64748b",
        }}
      >
        Loading marketplace products from server...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "3rem", color: "#ef4444" }}>
        <p>
          <strong>Error:</strong> {error}
        </p>
        <p style={{ fontSize: "0.9rem", color: "#64748b" }}>
          Check that the configured backend API is available.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.5rem", color: "#1e293b" }}>
        Featured Marketplace Products
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: "2rem",
        }}
      >
        {products.map((product) => (
          <div
            key={product.id}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              overflow: "hidden",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              backgroundColor: "#fff",
              display: "flex",
              flexDirection: "column",
              justify: "space-between",
            }}
          >
            <div>
              <img
                src={product.image}
                alt={product.name}
                onError={(e) => {
                  e.target.src =
                    "https://via.placeholder.com/300x180?text=Product+Image";
                }}
                style={{ width: "100%", height: "180px", objectFit: "cover" }}
              />
              <div style={{ padding: "1rem" }}>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "#2563eb",
                    fontWeight: "bold",
                    textTransform: "uppercase",
                  }}
                >
                  {product.category}
                </span>
                <h3
                  style={{
                    fontSize: "1.1rem",
                    margin: "0.5rem 0",
                    color: "#0f172a",
                  }}
                >
                  {product.name}
                </h3>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#64748b",
                    margin: "0 0 1rem 0",
                  }}
                >
                  Vendor: <strong>{product.vendor}</strong>
                </p>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: "bold",
                    color: "#16a34a",
                  }}
                >
                  ₦{product.price.toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{ padding: "1rem", paddingTop: "0" }}>
              <button
                onClick={() => onAddToCart(product)}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  backgroundColor: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                Add to Cart
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductList;
