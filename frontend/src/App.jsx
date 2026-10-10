import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProductList from "./components/ProductList";
import CartDrawer from "./components/CartDrawer";
import SellerDashboard from "./components/SellerDashboard";
import VendorDashboard from "./components/VendorDashboard";
import BuyerDashboard from "./components/BuyerDashboard";
import VendorStorefront from "./components/VendorStorefront";
import { useAuth } from "./context/AuthContext";

const DEMO_BUYER_ID = "650000000000000000000000";

function App() {
  const { isAuthenticated, role } = useAuth();
  const isVendor = isAuthenticated && role === "SELLER";
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isKycVerified, setIsKycVerified] = useState(false);
  const [activeTab, setActiveTab] = useState("products");
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);

  // Add product to cart or increment quantity if already present
  const addToCart = (product) => {
    setCart((prevCart) => {
      const existingItem = prevCart.find((item) => item.id === product.id);
      if (existingItem) {
        return prevCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prevCart, { ...product, quantity: 1 }];
    });
  };

  // Update item quantity
  const updateQuantity = (id, delta) => {
    setCart((prevCart) =>
      prevCart
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean),
    );
  };

  // Remove item completely
  const removeFromCart = (id) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== id));
  };

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const tabContent =
    activeTab === "vendor" && isVendor ? (
      <VendorDashboard />
    ) : activeTab === "seller" ? (
      <SellerDashboard />
    ) : activeTab === "buyer" ? (
      <BuyerDashboard
        buyerId={DEMO_BUYER_ID}
        refreshVersion={ordersRefreshVersion}
        setRefreshVersion={setOrdersRefreshVersion}
      />
    ) : (
      <ProductList onAddToCart={addToCart} />
    );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isKycVerified={isKycVerified}
        setIsKycVerified={setIsKycVerified}
        isVendor={isVendor}
      />

      <main className="max-w-7xl mx-auto px-4 py-8">
        <Routes>
          <Route
            path="/store/:vendorId"
            element={<VendorStorefront onAddToCart={addToCart} />}
          />
          <Route path="*" element={tabContent} />
        </Routes>
      </main>

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeFromCart}
        buyerId={DEMO_BUYER_ID}
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
