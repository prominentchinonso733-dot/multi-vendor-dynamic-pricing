import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";

const buttonStyle = (active) => ({
  background: "none",
  border: "none",
  color: active ? "#60a5fa" : "#fff",
  cursor: "pointer",
  fontWeight: active ? "bold" : "normal",
});

const Navbar = ({
  cartCount,
  activeTab,
  setActiveTab,
  onOpenCart,
  role,
  user,
  onLogout,
}) => {
  const navigate = useNavigate();
  const selectTab = (tab) => {
    setActiveTab(tab);
    navigate("/");
  };

  return (
    <nav
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "1rem 2rem",
        backgroundColor: "#1e293b",
        color: "#fff",
      }}
    >
      <h2>Escrow Marketplace MVP</h2>
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
        {role === "ADMIN" ? (
          <button
            aria-current="page"
            onClick={() => selectTab("seller")}
            style={buttonStyle(activeTab === "seller")}
            type="button"
          >
            Admin Dashboard
          </button>
        ) : role === "SELLER" ? (
          <button
            aria-current="page"
            onClick={() => selectTab("vendor")}
            style={buttonStyle(activeTab === "vendor")}
            type="button"
          >
            Vendor Dashboard
          </button>
        ) : null}
        {role !== "ADMIN" && role !== "SELLER" && (
          <>
            <button
              onClick={() => selectTab("products")}
              style={buttonStyle(activeTab === "products")}
              type="button"
            >
              Products
            </button>
            {role === "BUYER" && (
              <button
                onClick={() => selectTab("buyer")}
                style={buttonStyle(activeTab === "buyer")}
                type="button"
              >
                My Orders
              </button>
            )}
            <button
              onClick={onOpenCart}
              style={buttonStyle(false)}
              type="button"
            >
              Cart ({cartCount})
            </button>
            {!role && (
              <button
                onClick={() => navigate("/account")}
                style={{
                  ...buttonStyle(false),
                  border: "1px solid #94a3b8",
                  padding: "0.5rem 1rem",
                }}
                type="button"
              >
                Sign In / Register
              </button>
            )}
          </>
        )}
        {role && role !== "BUYER" && (
          <span aria-label="Signed in account">
            {user?.name || user?.email} ({role})
          </span>
        )}
        {role && (
          <button
            onClick={onLogout}
            style={{
              background: "none",
              border: "1px solid #94a3b8",
              color: "#fff",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
            type="button"
          >
            Sign Out
          </button>
        )}
      </div>
    </nav>
  );
};

Navbar.propTypes = {
  cartCount: PropTypes.number.isRequired,
  activeTab: PropTypes.string.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  onOpenCart: PropTypes.func.isRequired,
  role: PropTypes.string,
  user: PropTypes.shape({
    name: PropTypes.string,
    email: PropTypes.string,
  }),
  onLogout: PropTypes.func.isRequired,
};

export default Navbar;
