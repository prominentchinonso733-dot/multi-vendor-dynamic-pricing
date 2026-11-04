import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { io } from "socket.io-client";
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
import RiderDashboard from "./components/RiderDashboard";
import AiSupportWidget from "./components/AiSupportWidget";
import { useAuth } from "./context/AuthContext";
import { getRoleHomeRoute } from "./services/roleRoutes";
import { BACKEND_BASE_URL } from "./api";

function RequireRole({ role, allowAdmin = false, children }) {
  const { isAuthenticated, role: activeRole } = useAuth();

  if (!isAuthenticated) {
    const loginPath = {
      SELLER: "/vendor/login",
      ADMIN: "/admin/login",
      BUYER: "/account",
      DELIVERY_PARTNER: "/rider/login",
    }[role];
    return <Navigate to={loginPath} replace />;
  }
  if (activeRole !== role && !(allowAdmin && activeRole === "ADMIN")) {
    return <Navigate to={getRoleHomeRoute(activeRole) || "/"} replace />;
  }
  return children;
}

RequireRole.propTypes = {
  role: PropTypes.oneOf(["SELLER", "ADMIN", "BUYER", "DELIVERY_PARTNER"]).isRequired,
  allowAdmin: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

function VendorLoginRoute() {
  const { role } = useAuth();
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  if (role === "DELIVERY_PARTNER") return <Navigate to="/rider/dashboard" replace />;
  return <AccountAuth role="SELLER" />;
}

function AdminLoginRoute() {
  const { role } = useAuth();
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  if (role === "DELIVERY_PARTNER") return <Navigate to="/rider/dashboard" replace />;
  return <AccountAuth role="ADMIN" />;
}

function RiderLoginRoute() {
  const { role } = useAuth();
  if (role === "DELIVERY_PARTNER") return <Navigate to="/rider/dashboard" replace />;
  if (role === "ADMIN") return <Navigate to="/rider/dashboard" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  return <AccountAuth role="DELIVERY_PARTNER" />;
}

function BuyerLoginRoute() {
  const { role } = useAuth();
  if (role === "BUYER") return <Navigate to="/" replace />;
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "DELIVERY_PARTNER") return <Navigate to="/rider/dashboard" replace />;
  return <AccountAuth role="BUYER" />;
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

  useEffect(() => {
    const socket = io(BACKEND_BASE_URL, { transports: ["websocket", "polling"] });
    socket.on("product:updated", (update) => {
      setCart((items) =>
        items.map((item) =>
          (item.id || item._id) === update.id
            ? {
                ...item,
                price: update.currentPrice,
                currentPrice: update.currentPrice,
                stock: update.stock,
              }
            : item,
        ),
      );
    });
    return () => socket.disconnect();
  }, []);

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
          <Route path="/account" element={<BuyerLoginRoute />} />
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
          <Route path="/rider/login" element={<RiderLoginRoute />} />
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
            path="/rider/dashboard"
            element={
              <RequireRole allowAdmin role="DELIVERY_PARTNER">
                <RiderDashboard />
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
      <AiSupportWidget />
    </div>
  );
}

export default App;
