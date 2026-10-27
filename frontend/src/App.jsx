import { useState } from "react";
import PropTypes from "prop-types";
import { Navigate, Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProductList from "./components/ProductList";
import CartDrawer from "./components/CartDrawer";
import SellerDashboard from "./components/SellerDashboard";
import VendorDashboard from "./components/VendorDashboard";
import BuyerDashboard from "./components/BuyerDashboard";
import AdminDashboard from "./components/AdminDashboard";
import VendorStorefront from "./components/VendorStorefront";
import AccountAuth from "./components/AccountAuth";
import VerificationPanel from "./components/VerificationPanel";
import { useAuth } from "./context/AuthContext";
import { getRoleHomeRoute } from "./services/roleRoutes";

function RequireRole({ role, children }) {
  const { isAuthenticated, role: activeRole } = useAuth();

  if (!isAuthenticated) {
    const loginPath = {
      SELLER: "/vendor/login",
      ADMIN: "/admin/login",
      BUYER: "/account",
    }[role];
    return <Navigate to={loginPath} replace />;
  }
  if (activeRole !== role) {
    return <Navigate to={getRoleHomeRoute(activeRole) || "/"} replace />;
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
  if (role === "BUYER") return <Navigate to="/" replace />;
  return <AccountAuth role="SELLER" />;
}

function AdminLoginRoute() {
  const { role } = useAuth();
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  return <AccountAuth role="ADMIN" />;
}

function App() {
  const { role, user, logout } = useAuth();
  const buyerId = role === "BUYER" ? user?.id : null;
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
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
          <Route
            path="/account/verification"
            element={
              <RequireRole role="BUYER">
                <VerificationPanel />
              </RequireRole>
            }
          />
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
                <AdminDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/admin/escrow"
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
        onPaymentVerified={() =>
          setOrdersRefreshVersion((version) => version + 1)
        }
      />
    </div>
  );
}

export default App;
