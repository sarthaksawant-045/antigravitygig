import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../services/api";

const STEPS = { EMAIL: 1, OTP: 2, RESET: 3, DONE: 4 };

function normalizeRole(role) {
  const value = String(role || "client").toLowerCase().trim();
  return value === "artist" ? "freelancer" : value === "freelancer" ? "freelancer" : "client";
}

export default function ForgotPassword() {
  const { role: routeRole = "client" } = useParams();
  const role = normalizeRole(routeRole);
  const navigate = useNavigate();

  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOTP = async (e) => {
    e.preventDefault();
    if (!email) { setError("Enter your email"); return; }
    setLoading(true);
    setError("");
    try {
      const endpoint = role === "freelancer" ? "/freelancer/send-otp" : "/client/send-otp";
      const res = await api.post(endpoint, { email });
      if (res.debug_otp) {
        setOtp(res.debug_otp);
      }
      setStep(STEPS.OTP);
    } catch (err) {
      setError(err.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!otp) { setError("Enter the OTP"); return; }
    setLoading(true);
    setError("");
    try {
      const endpoint = role === "freelancer" ? "/freelancer/verify-otp-for-reset" : "/client/verify-otp-for-reset";
      await api.post(endpoint, { email, otp });
      setStep(STEPS.RESET);
    } catch (err) {
      setError(err.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const endpoint = role === "freelancer" ? "/freelancer/reset-password" : "/client/reset-password";
      await api.post(endpoint, { email, new_password: newPassword });
      setStep(STEPS.DONE);
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-card">
        <div className="auth-left">
          <h2>Reset Password</h2>

          {step !== STEPS.DONE && (
            <div className="cp-progress" style={{marginBottom: '1.5rem'}}>
              <div
                className="cp-bar"
                style={{width: step === STEPS.EMAIL ? '33%' : step === STEPS.OTP ? '66%' : '100%'}}
              />
            </div>
          )}

          {error && <div className="auth-alert">{error}</div>}

          {step === STEPS.EMAIL && (
            <form className="auth-form" onSubmit={handleSendOTP}>
              <p className="auth-helper">
                Enter the email address associated with your {role} account. We'll send you a verification code.
              </p>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  required
                />
              </label>
              <button className={`auth-primary${loading ? " is-loading" : ""}`} type="submit" disabled={loading}>
                {loading ? "Sending..." : "Send Reset Code"}
              </button>
            </form>
          )}

          {step === STEPS.OTP && (
            <form className="auth-form" onSubmit={handleVerifyOTP}>
              <p className="auth-helper">
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
              </p>
              <label>
                <span>Verification Code</span>
                <input
                  type="text"
                  placeholder="123456"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value); setError(""); }}
                  required
                  className="auth-code-input"
                />
              </label>
              <button className={`auth-primary${loading ? " is-loading" : ""}`} type="submit" disabled={loading}>
                {loading ? "Verifying..." : "Verify Code"}
              </button>
              <button
                type="button"
                className={`link-like${loading ? " is-loading" : ""}`}
                onClick={handleSendOTP}
                disabled={loading}
              >
                Resend Code
              </button>
            </form>
          )}

          {step === STEPS.RESET && (
            <form className="auth-form" onSubmit={handleResetPassword}>
              <p className="auth-helper">
                Create a new password for your account.
              </p>
              <label>
                <span>New Password</span>
                <input
                  type="password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                  required
                  minLength={6}
                />
              </label>
              <label>
                <span>Confirm Password</span>
                <input
                  type="password"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                  required
                  minLength={6}
                />
              </label>
              <button className={`auth-primary${loading ? " is-loading" : ""}`} type="submit" disabled={loading}>
                {loading ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          )}

          {step === STEPS.DONE && (
            <div className="auth-success-state">
              <div className="auth-success-icon">&#10003;</div>
              <h3>Password Reset Complete</h3>
              <p>
                Your password has been updated. You can now log in with your new password.
              </p>
              <button
                className="auth-primary"
                onClick={() => navigate(`/login/${role}`)}
                style={{maxWidth: '200px', margin: '0 auto'}}
              >
                Go to Login
              </button>
            </div>
          )}

          {step !== STEPS.DONE && (
            <p className="auth-foot">
              Remember your password?{" "}
              <Link to={`/login/${role}`}>Back to Login</Link>
            </p>
          )}
        </div>

        <aside className="auth-right">
          <div className="auth-right-inner">
            <h3>RESET</h3>
            <h3>PASSWORD</h3>
            <p>Secure your GigBridge account</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
