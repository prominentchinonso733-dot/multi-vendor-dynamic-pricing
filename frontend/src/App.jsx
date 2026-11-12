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
import AccountEntry from "./components/AccountEntry";
import VerificationPanel from "./components/VerificationPanel";
import RiderDashboard from "./components/RiderDashboard";
import AiSupportWidget from "./components/AiSupportWidget";
import { useAuth } from "./context/AuthContext";
import { getRoleHomeRoute } from "./services/roleRoutes";
import { BACKEND_BASE_URL } from "./api";

const getCartStorageKey = (buyerId) =>
  buyerId ? `marketplace-cart:${buyerId}` : null;

const clearStoredCart = (key) => {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
};

const saveStoredCart = (key, items) => {
  if (!key || typeof localStorage === "undefined") return;
  try {
    if (items.length > 0) {
      localStorage.setItem(key, JSON.stringify(items));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    return;
  }
};

const readStoredCart = (key) => {
  if (!key || typeof localStorage === "undefined") return [];

  try {
    const storedCart = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(storedCart)) {
      localStorage.removeItem(key);
      return [];
    }

    const validCart = storedCart.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        Number.isFinite(Number(item.price)) &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0,
    );
    if (validCart.length !== storedCart.length) {
      saveStoredCart(key, validCart);
    }
    return validCart;
  } catch {
    clearStoredCart(key);
    return [];
  }
};

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
  role: PropTypes.oneOf(["SELLER", "ADMIN", "BUYER", "DELIVERY_PARTNER"])
    .isRequired,
  allowAdmin: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

function VendorLoginRoute() {
  const { role } = useAuth();
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  if (role === "DELIVERY_PARTNER")
    return <Navigate to="/rider/dashboard" replace />;
  return <AccountAuth role="SELLER" />;
}

function AdminLoginRoute() {
  const { role } = useAuth();
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  if (role === "DELIVERY_PARTNER")
    return <Navigate to="/rider/dashboard" replace />;
  return <AccountAuth role="ADMIN" />;
}

function RiderLoginRoute() {
  const { role } = useAuth();
  if (role === "DELIVERY_PARTNER")
    return <Navigate to="/rider/dashboard" replace />;
  if (role === "ADMIN") return <Navigate to="/rider/dashboard" replace />;
  if (role === "SELLER") return <Navigate to="/vendor/dashboard" replace />;
  if (role === "BUYER") return <Navigate to="/" replace />;
  return <AccountAuth role="DELIVERY_PARTNER" />;
}

function App() {
  const { role, user, logout } = useAuth();
  const buyerId = role === "BUYER" ? user?.id : null;
  const cartStorageKey = getCartStorageKey(buyerId);
  const [cartSession, setCartSession] = useState({ key: null, items: [] });
  const cart = cartSession.key === cartStorageKey ? cartSession.items : [];
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);

  useEffect(() => {
    setCartSession({
      key: cartStorageKey,
      items: readStoredCart(cartStorageKey),
    });
  }, [cartStorageKey]);

  useEffect(() => {
    if (!cartStorageKey || cartSession.key !== cartStorageKey) return;
    saveStoredCart(cartStorageKey, cartSession.items);
  }, [cartSession, cartStorageKey]);

  const updateCart = (update) =>
    setCartSession((current) => ({
      key: cartStorageKey,
      items: update(current.key === cartStorageKey ? current.items : []),
    }));

  const addToCart = (product) => {
    const productId = String(product.id || product._id || "");
    if (!productId) return;

    updateCart((currentCart) => {
      const existingItem = currentCart.find((item) => item.id === productId);
      if (existingItem) {
        return currentCart.map((item) =>
          item.id === productId
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...currentCart, { ...product, id: productId, quantity: 1 }];
    });
  };

  const updateQuantity = (id, delta) =>
    updateCart((currentCart) =>
      currentCart
        .map((item) => {
          if (item.id !== id) return item;
          const quantity = item.quantity + delta;
          return quantity > 0 ? { ...item, quantity } : null;
        })
        .filter(Boolean),
    );

  const removeFromCart = (id) =>
    updateCart((currentCart) => currentCart.filter((item) => item.id !== id));

  const handleLogout = () => {
    clearStoredCart(cartStorageKey);
    setCartSession({ key: null, items: [] });
    setIsCartOpen(false);
    logout();
  };

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    const socket = io(BACKEND_BASE_URL, {
      transports: ["websocket", "polling"],
    });
    socket.on("product:updated", (update) => {
      setCartSession((current) => {
        if (current.key !== cartStorageKey) return current;
        return {
          ...current,
          items: current.items.map((item) =>
            item.id === update.id
              ? {
                  ...item,
                  price: update.currentPrice,
                  currentPrice: update.currentPrice,
                  stock: update.stock,
                }
              : item,
          ),
        };
      });
    });
    return () => socket.disconnect();
  }, [cartStorageKey]);

  return (
    <div className="app-shell">
      <Navbar
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        role={role}
        user={user}
        onLogout={handleLogout}
      />

      <main className="app-main">
        <Routes>
          <Route path="/" element={<ProductList onAddToCart={addToCart} />} />
          <Route path="/account" element={<AccountEntry />} />
          <Route path="/account/:role" element={<AccountEntry />} />
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
            path="/vendor/:vendorId"
            element={<VendorStorefront onAddToCart={addToCart} />}
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
