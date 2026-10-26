import { useState } from "react";
import PropTypes from "prop-types";
import { Navigate, Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProductList from "./components/ProductList";
import CartDrawer from "./components/CartDrawer";
import SellerDashboard from "./components/SellerDashboard";
import VendorDashboard from "./components/VendorDashboard";
import BuyerDashboard from "./components/BuyerDashboard";
import VendorStorefront from "./components/VendorStorefront";
import AccountAuth from "./components/AccountAuth";
import { useAuth } from "./context/AuthContext";

function RequireRole({ role, children }) {
  const { isAuthenticated, role: activeRole } = useAuth();

  if (!isAuthenticated) {
    return (
      <Navigate
        to={role === "SELLER" ? "/vendor/login" : "/admin/login"}
        replace
      />
    );
  }
  if (activeRole !== role) {
    return (
      <Navigate
        to={
          activeRole === "SELLER"
            ? "/vendor/dashboard"
            : activeRole === "ADMIN"
              ? "/admin"
              : "/"
        }
        replace
      />
    );
  }
  return children;
}

RequireRole.propTypes = {
  role: PropTypes.oneOf(["SELLER", "ADMIN", "BUYER"]).isRequired,
  children: PropTypes.node.isRequired,
};

function VendorLoginRoute() {
  const { role } = useAuth();
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  return <AccountAuth role="SELLER" />;
}

function AdminLoginRoute() {
  const { role } = useAuth();
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  return <SellerDashboard />;
}

function App() {
  const { role, user, logout } = useAuth();
  const buyerId = role === "BUYER" ? user?.id : null;
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isKycVerified, setIsKycVerified] = useState(false);
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);

  const addToCart = (product) => {
    setCart((currentCart) => {
      const existingItem = currentCart.find((item) => item.id === product.id);
      if (existingItem) {
        return currentCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...currentCart, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id, delta) =>
    setCart((currentCart) =>
      currentCart
        .map((item) => {
          if (item.id !== id) return item;
          const quantity = item.quantity + delta;
          return quantity > 0 ? { ...item, quantity } : null;
        })
        .filter(Boolean),
    );

  const removeFromCart = (id) =>
    setCart((currentCart) => currentCart.filter((item) => item.id !== id));

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-shell">
      <Navbar
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        role={role}
        user={user}
        onLogout={logout}
      />

      <main className="app-main">
        <Routes>
          <Route path="/" element={<ProductList onAddToCart={addToCart} />} />
          <Route path="/account" element={<AccountAuth role="BUYER" />} />
          <Route path="/vendor/login" element={<VendorLoginRoute />} />
          <Route path="/admin/login" element={<AdminLoginRoute />} />
          <Route
            path="/vendor/dashboard"
            element={
              <RequireRole role="SELLER">
                <VendorDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole role="ADMIN">
                <SellerDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/orders"
            element={
              <RequireRole role="BUYER">
                <BuyerDashboard
                  buyerId={buyerId}
                  refreshVersion={ordersRefreshVersion}
                  setRefreshVersion={setOrdersRefreshVersion}
                />
              </RequireRole>
            }
          />
          <Route
            path="/store/:vendorId"
            element={<VendorStorefront onAddToCart={addToCart} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeFromCart}
        buyerId={buyerId}
        isKycVerified={isKycVerified}
        setIsKycVerified={setIsKycVerified}
        onPaymentVerified={() =>
          setOrdersRefreshVersion((version) => version + 1)
        }
      />
    </div>
  );
}

export default App;
