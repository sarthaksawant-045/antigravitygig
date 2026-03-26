import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import { BadgeCheck, CircleDollarSign, Clock3, Star, Wallet } from "lucide-react";
import { getBrandLogoUrl } from "../utils/branding.js";
import "./PaymentPage.css";

export default function PaymentPage() {
  const { user } = useAuth();
  const [hires, setHires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Review states
  const [ratings, setRatings] = useState({});
  const [reviews, setReviews] = useState({});

  useEffect(() => {
    if (user?.id) {
      loadHires();
    }
  }, [user?.id]);

  const loadHires = async () => {
    setLoading(true);
    try {
      const data = await clientService.getHireRequests(user.id);
      setHires(data.requests || []);
    } catch {
      setError("Failed to load hire data");
    } finally {
      setLoading(false);
    }
  };

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handlePayNow = async (hire) => {
    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        setError("Failed to load payment gateway. Check your connection.");
        setActionLoading(false);
        return;
      }

      const orderData = await clientService.createPaymentOrder(hire.request_id);
      const brandLogoUrl = getBrandLogoUrl();

      const options = {
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "GigBridge",
        image: brandLogoUrl,
        description: `Payment for ${hire.job_title}`,
        order_id: orderData.order_id,
        handler: async function (response) {
          try {
            await clientService.verifyPayment(
              hire.request_id,
              response.razorpay_order_id,
              response.razorpay_payment_id,
              response.razorpay_signature
            );
            setSuccess("Payment successful!");
            loadHires();
          } catch (err) {
            setError(err.message || "Payment verification failed");
          }
        },
        prefill: {
          email: user.email || "",
          name: user.name || "",
        },
        theme: {
          color: "#2563eb",
        },
        modal: {
          ondismiss: function () {
            setActionLoading(false);
          },
        },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on("payment.failed", function (response) {
        setError(response.error?.description || "Payment failed");
        setActionLoading(false);
      });
      razorpay.open();
    } catch (err) {
      setError(err.message || "Failed to initiate payment");
      setActionLoading(false);
    }
  };

  const handleSubmitReview = async (hireId) => {
    const rating = ratings[hireId] || 5;
    const text = reviews[hireId] || "";

    setActionLoading(true);
    setError("");

    try {
      await clientService.submitReview(user.id, hireId, rating, text);
      setSuccess("Review submitted successfully! The gig is now complete.");
      loadHires();
    } catch (err) {
      setError("Failed to submit review");
    } finally {
      setActionLoading(false);
    }
  };

  const pendingPayments = hires.filter((h) => h.status === "ACCEPTED" && h.payment_status !== "paid");
  const awaitingReview = hires.filter((h) => h.status !== "COMPLETED" && h.payment_status === "paid" && h.event_status === "completed");
  const paymentHistory = hires.filter((h) => h.payment_status === "paid");

  return (
    <main className="payments-page">
      <header className="payments-header">
        <h1>Hires & Payments</h1>
        <p>Track your payments, reviews, and earnings in one place.</p>
      </header>

      {error && <div className="payments-alert payments-alert-error">{error}</div>}
      {success && <div className="payments-alert payments-alert-success">{success}</div>}

      <section className="payments-card payments-earnings-card">
        <div className="payments-earnings-copy">
          <div className="payments-icon-shell">
            <Wallet size={20} />
          </div>
          <div>
            <p className="payments-eyebrow">Overview</p>
            <h2>Total Earnings</h2>
          </div>
        </div>
        <div className="payments-earnings-amount">
          ₹{paymentHistory.reduce((sum, hire) => sum + Number(hire.final_agreed_amount || hire.proposed_budget || 0), 0)}
        </div>
      </section>

      <section className="payments-card">
        <div className="payments-section-head">
          <div className="payments-icon-shell payments-icon-shell-blue">
            <CircleDollarSign size={18} />
          </div>
          <h2>Pending Payments</h2>
        </div>
        {loading ? (
          <p className="payments-loading">Loading...</p>
        ) : pendingPayments.length === 0 ? (
          <div className="payments-empty-state">
            <div className="payments-empty-icon payments-empty-icon-success">
              <BadgeCheck size={28} />
            </div>
            <h3>You're all caught up!</h3>
            <p>No pending payments.</p>
          </div>
        ) : (
          <div className="payments-list">
            {pendingPayments.map((hire) => (
              <div key={hire.request_id} className="payments-item payments-item-action">
                <div className="payments-item-main">
                  <div>
                    <h3>{hire.job_title}</h3>
                    <p className="payments-item-meta">
                      Freelancer: {hire.freelancer_name} ({hire.freelancer_category})
                    </p>
                  </div>
                  <p className="payments-item-amount">Agreed Amount: ₹{hire.final_agreed_amount || hire.proposed_budget}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handlePayNow(hire)}
                  disabled={actionLoading}
                  className="payments-primary-button"
                >
                  Pay Now
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="payments-card">
        <div className="payments-section-head">
          <div className="payments-icon-shell payments-icon-shell-amber">
            <Star size={18} />
          </div>
          <h2>Awaiting Review</h2>
        </div>
        {loading ? (
          <p className="payments-loading">Loading...</p>
        ) : awaitingReview.length === 0 ? (
          <div className="payments-empty-state payments-empty-state-muted">
            <div className="payments-stars-row" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star key={star} size={24} className="payments-empty-star" />
              ))}
            </div>
            <h3>No reviews pending yet</h3>
            <p>Completed gigs will appear here for you to rate.</p>
          </div>
        ) : (
          <div className="payments-list">
            {awaitingReview.map((hire) => (
              <div key={hire.request_id} className="payments-item payments-review-item">
                <div className="payments-review-head">
                  <div>
                    <h3>{hire.job_title}</h3>
                    <p className="payments-item-meta">Freelancer has marked the work as completed.</p>
                  </div>
                </div>

                <div className="payments-stars-row">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      size={24}
                      color={star <= (ratings[hire.request_id] || 5) ? "#f59e0b" : "#d1d5db"}
                      fill={star <= (ratings[hire.request_id] || 5) ? "#f59e0b" : "none"}
                      className="payments-rating-star"
                      onClick={() => setRatings({ ...ratings, [hire.request_id]: star })}
                    />
                  ))}
                </div>

                <textarea
                  placeholder="Leave a review for the freelancer's profile..."
                  value={reviews[hire.request_id] || ""}
                  onChange={(e) => setReviews({ ...reviews, [hire.request_id]: e.target.value })}
                  className="payments-review-textarea"
                />

                <button
                  type="button"
                  onClick={() => handleSubmitReview(hire.request_id)}
                  disabled={actionLoading}
                  className="payments-success-button"
                >
                  Submit Review & Complete Gig
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="payments-card">
        <div className="payments-section-head">
          <div className="payments-icon-shell payments-icon-shell-slate">
            <Clock3 size={18} />
          </div>
          <h2>Payment History & Completed</h2>
        </div>
        {loading ? (
          <p className="payments-loading">Loading...</p>
        ) : paymentHistory.length === 0 ? (
          <div className="payments-empty-state payments-empty-state-muted">
            <div className="payments-empty-icon payments-empty-icon-muted">
              <Clock3 size={26} />
            </div>
            <h3>No payment history yet</h3>
            <p>Completed and paid gigs will appear here.</p>
          </div>
        ) : (
          <div className="payments-history-list">
            {paymentHistory.map((hire) => (
              <div key={hire.request_id} className="payments-history-item">
                <div className="payments-history-left">
                  <div className="payments-history-title">{hire.job_title}</div>
                  <div className="payments-history-meta">Freelancer: {hire.freelancer_name}</div>
                </div>
                <div className="payments-history-right">
                  <div className="payments-history-amount">₹{hire.final_agreed_amount || hire.proposed_budget}</div>
                  <div className="payments-badges">
                    <span className="payments-badge payments-badge-paid">PAID</span>
                    {hire.status === "COMPLETED" && (
                      <span className="payments-badge payments-badge-completed">COMPLETED</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
