import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";

const Navbar = ({
  cartCount,
  activeTab,
  setActiveTab,
  onOpenCart,
  isKycVerified,
  isVendor,
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
        <button
          aria-pressed={isKycVerified}
          title={isKycVerified ? "KYC verified" : "KYC verification required"}
          style={{
            background: "none",
            border: "none",
            color: activeTab === "products" ? "#60a5fa" : "#fff",
            cursor: "pointer",
            fontWeight: "bold",
          }}
          onClick={() => selectTab("products")}
        >
          Products
        </button>
        <button
          style={{
            background: "none",
            border: "none",
            color: activeTab === "buyer" ? "#60a5fa" : "#fff",
            cursor: "pointer",
            fontWeight: activeTab === "buyer" ? "bold" : "normal",
          }}
          onClick={() => selectTab("buyer")}
        >
          My Orders
        </button>
        <button
          style={{
            background: "none",
            border: "none",
            color: activeTab === "seller" ? "#60a5fa" : "#fff",
            cursor: "pointer",
            fontWeight: activeTab === "seller" ? "bold" : "normal",
          }}
          onClick={() => selectTab("seller")}
        >
          Seller Dashboard
        </button>
        {isVendor && (
          <button
            aria-current={activeTab === "vendor" ? "page" : undefined}
            style={{
              background: "none",
              border: "none",
              color: activeTab === "vendor" ? "#60a5fa" : "#fff",
              cursor: "pointer",
              fontWeight: activeTab === "vendor" ? "bold" : "normal",
            }}
            onClick={() => selectTab("vendor")}
          >
            Vendor Dashboard
          </button>
        )}
        <button
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            cursor: "pointer",
          }}
          onClick={onOpenCart}
        >
          Cart ({cartCount})
        </button>
        <button
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          onClick={() => selectTab("kyc")}
        >
          {isKycVerified ? "KYC Verified" : "4-Way KYC"}
        </button>
      </div>
    </nav>
  );
};

Navbar.propTypes = {
  cartCount: PropTypes.number.isRequired,
  activeTab: PropTypes.string.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  onOpenCart: PropTypes.func.isRequired,
  isKycVerified: PropTypes.bool.isRequired,
  isVendor: PropTypes.bool,
};

export default Navbar;
