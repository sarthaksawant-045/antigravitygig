import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { getBrandLogoUrl } from "../utils/branding.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const RAZORPAY_SCRIPT_ID = "razorpay-checkout-script";

function formatExpiryDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function hasActivePremium(user) {
  if (!user?.is_premium || !user?.premium_valid_until) return false;
  const expiry = new Date(user.premium_valid_until);
  return !Number.isNaN(expiry.getTime()) && expiry > new Date();
}

export default function FreelancerProfile({ user }) {
  const { updateUser } = useAuth();
  const [profileState, setProfileState] = useState(user);
  const [scriptReady, setScriptReady] = useState(Boolean(window.Razorpay));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setProfileState(user);
  }, [user]);

  useEffect(() => {
    if (window.Razorpay) {
      setScriptReady(true);
      return undefined;
    }

    const existingScript = document.getElementById(RAZORPAY_SCRIPT_ID);
    if (existingScript) {
      const handleLoad = () => setScriptReady(true);
      const handleError = () => setError("Unable to load Razorpay checkout.");
      existingScript.addEventListener("load", handleLoad);
      existingScript.addEventListener("error", handleError);
      return () => {
        existingScript.removeEventListener("load", handleLoad);
        existingScript.removeEventListener("error", handleError);
      };
    }

    const script = document.createElement("script");
    script.id = RAZORPAY_SCRIPT_ID;
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () => setError("Unable to load Razorpay checkout.");
    document.body.appendChild(script);

    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, []);

  const premiumActive = useMemo(() => hasActivePremium(profileState), [profileState]);
  const validUntilLabel = useMemo(
    () => formatExpiryDate(profileState?.premium_valid_until),
    [profileState?.premium_valid_until]
  );

  const handleUpgradeClick = async () => {
    if (!profileState?.id) {
      setError("Freelancer id is missing.");
      return;
    }

    if (!scriptReady || !window.Razorpay) {
      setError("Razorpay is not ready yet. Please try again.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const orderResponse = await fetch(`${API_BASE_URL}/api/payments/create-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          freelancer_id: profileState.id,
          plan_name: "PREMIUM",
        }),
      });

      const orderData = await orderResponse.json();
      if (!orderResponse.ok || orderData.success === false) {
        throw new Error(orderData.msg || "Failed to create subscription order.");
      }

      const brandLogoUrl = getBrandLogoUrl();

      const options = {
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency || "INR",
        name: "GigBridge",
        image: brandLogoUrl,
        description: "Premium Subscription (3 Months)",
        order_id: orderData.razorpay_order_id,
        prefill: {
          name: profileState.name || "",
          email: profileState.email || "",
        },
        theme: {
          color: "#2563eb",
        },
        handler: async (response) => {
          try {
            const verifyResponse = await fetch(`${API_BASE_URL}/api/payments/verify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                freelancer_id: profileState.id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyResponse.json();
            if (!verifyResponse.ok || verifyData.success === false) {
              throw new Error(verifyData.msg || "Payment verification failed.");
            }

            setProfileState((prev) => ({
              ...prev,
              is_premium: !!verifyData?.user?.is_premium,
              premium_valid_until: verifyData?.user?.premium_valid_until || prev?.premium_valid_until,
            }));
            if (verifyData?.user) {
              updateUser(verifyData.user);
            }
          } catch (verifyError) {
            setError(verifyError.message || "Payment verification failed.");
          } finally {
            setIsSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => {
            setIsSubmitting(false);
          },
        },
      };

      const razorpayInstance = new window.Razorpay(options);
      razorpayInstance.open();
    } catch (requestError) {
      setError(requestError.message || "Unable to start premium upgrade.");
      setIsSubmitting(false);
    }
  };

  return (
    <section
      style={{
        margin: "0 0 24px",
        padding: "18px 20px",
        borderRadius: "12px",
        border: "1px solid #dbeafe",
        background: premiumActive ? "#eff6ff" : "#f8fafc",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
            {profileState?.name ? `${profileState.name}'s Subscription` : "Subscription"}
          </h3>
          <p style={{ margin: "6px 0 0", color: "#475569", fontSize: "14px" }}>
            Manage your premium visibility and recommendation boost.
          </p>
        </div>

        {premiumActive ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "9999px",
              background: "#dbeafe",
              color: "#1d4ed8",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            Premium Subscription Active
          </span>
        ) : (
          <button
            type="button"
            onClick={handleUpgradeClick}
            disabled={isSubmitting || !scriptReady}
            style={{
              border: "none",
              borderRadius: "10px",
              background: isSubmitting || !scriptReady ? "#94a3b8" : "#2563eb",
              color: "#ffffff",
              padding: "10px 16px",
              fontWeight: 600,
              cursor: isSubmitting || !scriptReady ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Processing..." : "Upgrade to Premium (3 Months)"}
          </button>
        )}
      </div>

      {premiumActive ? (
        <div style={{ marginTop: "14px" }}>
          <p style={{ margin: 0, color: "#0f172a", fontWeight: 600 }}>
            {"🚀 Your profile is boosted! You receive priority placement in client recommendations."}
          </p>
          {validUntilLabel ? (
            <p style={{ margin: "8px 0 0", color: "#475569", fontSize: "14px" }}>
              Subscription valid until: {validUntilLabel}
            </p>
          ) : null}
        </div>
      ) : (
        <p style={{ margin: "14px 0 0", color: "#64748b", fontSize: "14px" }}>
          Upgrade to unlock priority recommendation placement for the next 3 months.
        </p>
      )}

      {error ? (
        <p style={{ margin: "12px 0 0", color: "#dc2626", fontSize: "14px" }}>{error}</p>
      ) : null}
    </section>
  );
}
