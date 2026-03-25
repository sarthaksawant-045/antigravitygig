import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import { Star } from "lucide-react";

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

      const options = {
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "GigBridge",
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

  const pendingPayments = hires.filter(h => h.status === "ACCEPTED" && h.payment_status !== "paid");
  const awaitingReview = hires.filter(h => h.status !== "COMPLETED" && h.payment_status === "paid" && h.event_status === "completed");
  const paymentHistory = hires.filter(h => h.payment_status === "paid");

  return (
    <main style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1.5rem', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1.5rem' }}>Hires & Payments</h1>

      {error && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          {success}
        </div>
      )}

      {/* PENDING PAYMENTS */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Pending Payments</h2>
        {loading ? (
          <p>Loading...</p>
        ) : pendingPayments.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No pending payments.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pendingPayments.map(hire => (
              <div key={hire.request_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9fafb', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem' }}>{hire.job_title}</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#4b5563' }}>Freelancer: {hire.freelancer_name} ({hire.freelancer_category})</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                    Agreed Amount: ₹{hire.final_agreed_amount || hire.proposed_budget}
                  </p>
                </div>
                <button
                  onClick={() => handlePayNow(hire)}
                  disabled={actionLoading}
                  style={{ background: '#2563eb', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                >
                  Pay Now
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AWAITING REVIEW / APPROVAL */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Awaiting Review</h2>
        {loading ? (
          <p>Loading...</p>
        ) : awaitingReview.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No gigs awaiting review.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {awaitingReview.map(hire => (
              <div key={hire.request_id} style={{ background: '#f9fafb', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem' }}>{hire.job_title}</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#4b5563' }}>Freelancer has marked the work as completed.</p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <Star 
                      key={star} 
                      size={24} 
                      color={star <= (ratings[hire.request_id] || 5) ? '#f59e0b' : '#d1d5db'}
                      fill={star <= (ratings[hire.request_id] || 5) ? '#f59e0b' : 'none'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setRatings({ ...ratings, [hire.request_id]: star })}
                    />
                  ))}
                </div>
                
                <textarea 
                  placeholder="Leave a review for the freelancer's profile..."
                  value={reviews[hire.request_id] || ""}
                  onChange={(e) => setReviews({ ...reviews, [hire.request_id]: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', marginBottom: '1rem', resize: 'vertical', minHeight: '80px', fontFamily: 'inherit' }}
                />
                
                <button
                  onClick={() => handleSubmitReview(hire.request_id)}
                  disabled={actionLoading}
                  style={{ background: '#10b981', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                >
                  Submit Review & Complete Gig
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PAYMENT HISTORY */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Payment History & Completed</h2>
        {loading ? (
          <p>Loading...</p>
        ) : paymentHistory.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No payment history.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {paymentHistory.map(hire => (
              <div key={hire.request_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{hire.job_title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    Freelancer: {hire.freelancer_name}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                    ₹{hire.final_agreed_amount || hire.proposed_budget}
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#16a34a', background: '#f0fdf4', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                    PAID
                  </span>
                  {hire.status === 'COMPLETED' && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#4f46e5', background: '#e0e7ff', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                      COMPLETED
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
