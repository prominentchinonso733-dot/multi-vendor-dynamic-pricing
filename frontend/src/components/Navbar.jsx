import PropTypes from "prop-types";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./Navbar.css";

export default function Navbar({ cartCount, onOpenCart, role, user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isVendor = role === "SELLER";
  const isAdmin = role === "ADMIN";
  const isCustomer = !role || role === "BUYER";

  const linkClassName = (path) =>
    `site-nav__link${location.pathname === path ? " site-nav__link--active" : ""}`;
  const handleLogout = () => {
    onLogout();
    navigate("/", { replace: true });
  };

  return (
    <header className="site-header">
      <Link aria-label="Marketplace home" className="site-brand" to="/">
        <span className="site-brand__mark" aria-hidden="true">
          M
        </span>
        <span>Market<span className="site-brand__accent">place</span></span>
      </Link>
      <nav aria-label="Main navigation" className="site-nav">
        {isCustomer && (
          <>
            <Link className={linkClassName("/")} to="/">
              Explore products
            </Link>
            {role === "BUYER" && (
              <Link className={linkClassName("/orders")} to="/orders">
                My orders
              </Link>
            )}
            <button
              aria-label={`Open cart with ${cartCount} items`}
              className="site-nav__cart"
              onClick={onOpenCart}
              type="button"
            >
              Cart <span>{cartCount}</span>
            </button>
            {!role ? (
              <Link className="site-nav__primary" to="/account">
                Sign in / Register
              </Link>
            ) : (
              <>
                <span className="site-nav__identity">
                  {user?.name || user?.email}
                </span>
                <button
                  className="site-nav__link site-nav__button"
                  onClick={handleLogout}
                  type="button"
                >
                  Sign out
                </button>
              </>
            )}
          </>
        )}
        {isVendor && (
          <>
            <Link className={linkClassName("/")} to="/">
              View marketplace
            </Link>
            <Link
              className="site-nav__primary"
              to="/vendor/dashboard"
            >
              Store management
            </Link>
            <span className="site-nav__identity">
              {user?.name || user?.email}
            </span>
            <button
              className="site-nav__link site-nav__button"
              onClick={handleLogout}
              type="button"
            >
              Sign out
            </button>
          </>
        )}
        {isAdmin && (
          <>
            <Link className={linkClassName("/")} to="/">
              View marketplace
            </Link>
            <Link className="site-nav__primary" to="/admin">
              Admin panel
            </Link>
            <span className="site-nav__identity">
              {user?.name || user?.email}
            </span>
            <button
              className="site-nav__link site-nav__button"
              onClick={handleLogout}
              type="button"
            >
              Sign out
            </button>
          </>
        )}
      </nav>
    </header>
  );
}

Navbar.propTypes = {
  cartCount: PropTypes.number.isRequired,
  onOpenCart: PropTypes.func.isRequired,
  role: PropTypes.string,
  user: PropTypes.shape({
    name: PropTypes.string,
    email: PropTypes.string,
  }),
  onLogout: PropTypes.func.isRequired,
};
