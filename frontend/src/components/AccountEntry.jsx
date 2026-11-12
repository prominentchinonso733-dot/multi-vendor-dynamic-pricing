import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AccountAuth from "./AccountAuth";
import "./AccountEntry.css";

const roleOptions = [
  {
    key: "customer",
    role: "BUYER",
    title: "Customer",
    description: "Shop products and manage your orders.",
  },
  {
    key: "vendor",
    role: "SELLER",
    title: "Vendor / Seller",
    description: "Create a storefront and sell in the marketplace.",
  },
  {
    key: "rider",
    role: "DELIVERY_PARTNER",
    title: "Rider",
    description: "Deliver marketplace orders.",
  },
];

export default function AccountEntry() {
  const { role: roleKey } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedRole = roleOptions.find((option) => option.key === roleKey);
  const initialMode =
    searchParams.get("mode") === "register" ? "register" : "login";

  if (roleKey) {
    if (!selectedRole) {
      return (
        <section className="account-entry" aria-labelledby="account-entry-title">
          <h1 id="account-entry-title">Account type not found</h1>
          <Link to="/account">Choose an account type</Link>
        </section>
      );
    }

    return (
      <AccountAuth
        key={`${selectedRole.role}-${initialMode}`}
        role={selectedRole.role}
        initialMode={initialMode}
      />
    );
  }

  return (
    <section className="account-entry" aria-labelledby="account-entry-title">
      <p className="account-entry__eyebrow">MARKETPLACE ACCESS</p>
      <h1 id="account-entry-title">Choose your account type</h1>
      <p>Sign in or register as a customer, vendor, or delivery rider.</p>
      <div className="account-entry__mode" aria-label="Choose sign-in or registration">
        <button
          aria-pressed={initialMode === "login"}
          onClick={() => navigate("/account?mode=login")}
          type="button"
        >
          Sign In
        </button>
        <button
          aria-pressed={initialMode === "register"}
          onClick={() => navigate("/account?mode=register")}
          type="button"
        >
          Register
        </button>
      </div>
      <div className="account-entry__roles">
        {roleOptions.map((option) => (
          <button
            className="account-entry__role"
            key={option.role}
            onClick={() =>
              navigate(`/account/${option.key}?mode=${initialMode}`)
            }
            type="button"
          >
            <strong>{option.title}</strong>
            <span>{option.description}</span>
            <span className="account-entry__continue">
              Continue to {initialMode === "register" ? "register" : "sign in"} →
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
