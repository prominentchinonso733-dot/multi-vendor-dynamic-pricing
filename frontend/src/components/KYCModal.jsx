import { useState } from "react";

const KYCModal = () => {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    idType: "NIN",
    idNumber: "",
  });

  const [status, setStatus] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setStatus("verifying");

    // Simulating backend KYC API verification request
    setTimeout(() => {
      setStatus("success");
    }, 1500);
  };

  return (
    <div
      style={{
        maxWidth: "500px",
        margin: "2rem auto",
        padding: "2rem",
        backgroundColor: "#fff",
        borderRadius: "10px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        border: "1px solid #e2e8f0",
      }}
    >
      <h2 style={{ marginBottom: "0.5rem", color: "#0f172a" }}>
        4-Way Identity Verification
      </h2>
      <p
        style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1.5rem" }}
      >
        Complete compliance verification to activate high-value marketplace
        transactions.
      </p>

      {status === "success" ? (
        <div
          style={{
            padding: "1rem",
            backgroundColor: "#dcfce7",
            color: "#15803d",
            borderRadius: "6px",
            textAlign: "center",
            fontWeight: "bold",
          }}
        >
          ✅ Verification Submitted Successfully!
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: "bold",
                marginBottom: "0.3rem",
              }}
            >
              Full Legal Name
            </label>
            <input
              type="text"
              name="fullName"
              required
              value={formData.fullName}
              onChange={handleChange}
              placeholder="e.g. John Doe"
              style={{
                width: "100%",
                padding: "0.6rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: "bold",
                marginBottom: "0.3rem",
              }}
            >
              Email Address
            </label>
            <input
              type="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="user@example.com"
              style={{
                width: "100%",
                padding: "0.6rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: "bold",
                marginBottom: "0.3rem",
              }}
            >
              Identification Document Type
            </label>
            <select
              name="idType"
              value={formData.idType}
              onChange={handleChange}
              style={{
                width: "100%",
                padding: "0.6rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
              }}
            >
              <option value="NIN">National Identification Number (NIN)</option>
              <option value="BVN">Bank Verification Number (BVN)</option>
              <option value="DriversLicense">Driver&apos;s License</option>
              <option value="Passport">International Passport</option>
            </select>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: "bold",
                marginBottom: "0.3rem",
              }}
            >
              Document ID Number
            </label>
            <input
              type="text"
              name="idNumber"
              required
              value={formData.idNumber}
              onChange={handleChange}
              placeholder="Enter number"
              style={{
                width: "100%",
                padding: "0.6rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={status === "verifying"}
            style={{
              padding: "0.75rem",
              backgroundColor: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: "pointer",
              marginTop: "1rem",
            }}
          >
            {status === "verifying"
              ? "Verifying Credentials..."
              : "Submit Verification"}
          </button>
        </form>
      )}
    </div>
  );
};

export default KYCModal;
