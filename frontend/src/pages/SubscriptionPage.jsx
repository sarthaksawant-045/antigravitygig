import { useState, useEffect, useMemo } from 'react';
import DashboardHeader from '../components/DashboardHeader';
import DashboardSidebar from '../components/DashboardSidebar';
import { Star, Crown, Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { getBrandLogoUrl } from '../utils/branding.js';
import './subscription.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://antigravitygig-2.onrender.com';

const SubscriptionPage = () => {
  const [activeSidebar, setActiveSidebar] = useState('subscription');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [razorpayReady, setRazorpayReady] = useState(Boolean(window.Razorpay));
  const { user, updateUser } = useAuth();
  const premiumActive = useMemo(() => {
    if (!user?.is_premium || !user?.premium_valid_until) return false;
    const expiry = new Date(user.premium_valid_until);
    return !Number.isNaN(expiry.getTime()) && expiry > new Date();
  }, [user]);
  const premiumExpiryLabel = useMemo(() => {
    if (!user?.premium_valid_until) return '';
    const expiry = new Date(user.premium_valid_until);
    if (Number.isNaN(expiry.getTime())) return '';
    return expiry.toLocaleDateString('en-IN', {
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    });
  }, [user?.premium_valid_until]);

  useEffect(() => {
    if (window.Razorpay) {
      setRazorpayReady(true);
      return undefined;
    }

    const existingScript = document.getElementById('razorpay-checkout-script');
    if (existingScript) {
      const handleLoad = () => setRazorpayReady(true);
      existingScript.addEventListener('load', handleLoad);
      return () => existingScript.removeEventListener('load', handleLoad);
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setRazorpayReady(true);
    script.onerror = () => setPaymentError('Unable to load Razorpay checkout.');
    document.body.appendChild(script);

    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, []);

  const plans = [
    {
      name: 'Basic',
      subtitle: 'Perfect for getting started',
      price: 0,
      priceText: '₹0',
      billingText: 'Free Forever',
      icon: Star,
      isCurrent: true, // Basic is always current plan
      isPopular: false,
      buttonText: 'Current Plan',
      buttonDisabled: true,
      features: [
        '5 Portfolio Projects',
        '10 Job Applies per Month',
        'Standard Search Visibility',
        'Full Messaging Access'
      ]
    },
    {
      name: 'Premium',
      subtitle: 'Best for active artists and freelancers',
      price: 499,
      priceText: '₹499',
      billingText: '/ 3 months',
      icon: Crown,
      isCurrent: premiumActive,
      isPopular: true,
      buttonText: premiumActive ? 'Already Active' : 'Upgrade Now',
      buttonDisabled: premiumActive,
      features: [
        'Unlimited Portfolio',
        'Unlimited Job Applies',
        'Moderate Rank Boost in Search',
        'Premium Profile Badge',
        'Highlight 3 Projects on Profile',
        'Featured Grid Priority Placement',
        'Basic Performance Analytics',
        'Early Job Alerts'
      ]
    }
  ];

  const handleUpgradeClick = (plan) => {
    if (premiumActive) {
      setPaymentError('Your Premium subscription is already active.');
      return;
    }
    setPaymentError('');
    setSelectedPlan(plan);
    setShowUpgradeModal(true);
  };

  const handleModalClose = () => {
    if (isProcessing) return;
    setShowUpgradeModal(false);
    setSelectedPlan(null);
    setPaymentError('');
  };

  const handleProceed = async () => {
    if (!user?.id) {
      setPaymentError('Freelancer account not found. Please log in again.');
      return;
    }

    if (!razorpayReady || !window.Razorpay) {
      setPaymentError('Razorpay checkout is not ready yet.');
      return;
    }

    setIsProcessing(true);
    setPaymentError('');

    try {
      const orderResponse = await fetch(`${API_BASE_URL}/api/payments/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          freelancer_id: user.id,
          plan_name: 'PREMIUM',
        }),
      });

      const orderData = await orderResponse.json();
      if (!orderResponse.ok || orderData.success === false) {
        throw new Error(orderData.msg || 'Failed to create Razorpay order.');
      }

      const brandLogoUrl = getBrandLogoUrl();

      const razorpay = new window.Razorpay({
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency || 'INR',
        name: 'GigBridge',
        image: brandLogoUrl,
        description: 'Premium Subscription (3 Months)',
        order_id: orderData.razorpay_order_id,
        prefill: {
          name: user.name || '',
          email: user.email || '',
        },
        theme: {
          color: '#2563eb',
        },
        handler: async (response) => {
          try {
            const verifyResponse = await fetch(`${API_BASE_URL}/api/payments/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                freelancer_id: user.id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyResponse.json();
            if (!verifyResponse.ok || verifyData.success === false) {
              throw new Error(verifyData.msg || 'Payment verification failed.');
            }

            if (verifyData?.user) {
              updateUser(verifyData.user);
            }
            setShowUpgradeModal(false);
            setSelectedPlan(null);
            alert('Premium subscription activated successfully.');
          } catch (error) {
            setPaymentError(error.message || 'Payment verification failed.');
          } finally {
            setIsProcessing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setIsProcessing(false);
          },
        },
      });

      razorpay.open();
    } catch (error) {
      setPaymentError(error.message || 'Unable to start payment.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="db-layout">
      <DashboardHeader />
      <div className="db-shell">
        <DashboardSidebar active={activeSidebar} onSelect={setActiveSidebar} />
        <main className="db-main subscription-page">
          {/* Page Header */}
          <div className="subscription-header">
            <h2>Choose Your Plan</h2>
            <p>Select the perfect plan to grow your freelance career and get more opportunities on GigBridge.</p>
            {premiumActive && premiumExpiryLabel && (
              <p style={{ marginTop: '8px', color: '#1d4ed8', fontWeight: 600 }}>
                Premium is already active until {premiumExpiryLabel}.
              </p>
            )}
          </div>

          {/* Plans Container */}
          <div className="plans-container">
            <div className="plans-grid">
              {plans.map((plan, index) => {
                const Icon = plan.icon;
                return (
                  <div 
                    key={plan.name}
                    className={`plan-card ${plan.isPopular ? 'popular' : ''} ${plan.isCurrent ? 'current' : ''}`}
                  >
                    {/* Popular Badge */}
                    {plan.isPopular && (
                      <div className="popular-badge">
                        Most Popular
                      </div>
                    )}

                    {/* Plan Content */}
                    <div className="plan-content">
                      {/* Icon */}
                      <div className="plan-icon">
                        <Icon className="w-8 h-8" />
                      </div>

                      {/* Plan Title */}
                      <div className="plan-title">
                        <h3>{plan.name}</h3>
                        <p>{plan.subtitle}</p>
                      </div>

                      {/* Price */}
                      <div className="plan-price">
                        <div className="price-amount">
                          <span className="currency">₹</span>
                          <span className="price">{plan.price}</span>
                        </div>
                        <div className="billing-text">{plan.billingText}</div>
                      </div>

                      {/* Features */}
                      <div className="plan-features">
                        {plan.features.map((feature, featureIndex) => (
                          <div key={featureIndex} className="feature-item">
                            <Check className="w-4 h-4 text-green-600" />
                            <span>{feature}</span>
                          </div>
                        ))}
                      </div>

                      {/* Button */}
                      <button
                        className={`plan-button ${plan.isCurrent ? 'current' : 'primary'} ${plan.buttonDisabled ? 'disabled' : ''}`}
                        onClick={() => !plan.buttonDisabled && handleUpgradeClick(plan)}
                        disabled={plan.buttonDisabled}
                      >
                        {plan.buttonText}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Upgrade Modal */}
          {showUpgradeModal && (
            <div className="modal-overlay" onClick={handleModalClose}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Upgrade to Premium</h3>
                  <button className="modal-close" onClick={handleModalClose}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="modal-body">
                  <p>Complete checkout to activate your Premium plan.</p>
                  <div className="modal-plan-info">
                    <div className="plan-name">{selectedPlan?.name} Plan</div>
                    <div className="plan-price-modal">{selectedPlan?.priceText} {selectedPlan?.billingText}</div>
                  </div>
                  {paymentError && <p style={{ color: '#dc2626', marginTop: '12px' }}>{paymentError}</p>}
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={handleModalClose} disabled={isProcessing}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleProceed} disabled={isProcessing || !razorpayReady}>
                    {isProcessing ? 'Processing...' : 'Proceed'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default SubscriptionPage;


