import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Play,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";

const TYPEWRITER_TERMS = [
  "illustrators with gallery-grade restraint",
  "musicians for atmospheric commissions",
  "photographers with museum-level polish",
  "painters for bold cultural storytelling",
];

const HERO_CONTENT = {
  kicker: "#1 Platform for Creative Talent",
  title: "Hire Talented Artists for Your",
  titleAccent: "Creative Projects",
  subtitle:
    "Connect with professional designers, illustrators, painters, and digital artists worldwide.",
  primaryButtonText: "Hire a Freelancer",
  secondaryButtonText: "Become an Artist",
};

const FLOATING_PIECES = [
  { id: "orb-one", type: "orb", depth: 0.12 },
  { id: "orb-two", type: "orb", depth: 0.16 },
  { id: "ribbon-one", type: "chrome-ribbon", depth: 0.2 },
  { id: "ribbon-two", type: "chrome-ribbon", depth: 0.26 },
  { id: "silk-one", type: "silk", depth: 0.18 },
  { id: "silk-two", type: "silk", depth: 0.22 },
];

function applyRipple(event) {
  const button = event.currentTarget;
  const ripple = document.createElement("span");
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);

  ripple.className = "home-ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

  button.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 550);
}

export default function Hero() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const heroRef = useRef(null);
  const typewriterTerms = useMemo(() => TYPEWRITER_TERMS, []);
  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const [typedText, setTypedText] = useState("");
  const [termIndex, setTermIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);

  useEffect(() => {
    if (user.isAuthenticated) {
      if (user.role === "freelancer") {
        navigate("/artist/dashboard", { replace: true });
      } else if (user.role === "client") {
        navigate("/onboarding", { replace: true });
      }
    }
  }, [user.isAuthenticated, user.role, navigate]);

  useEffect(() => {
    const activeTerm = typewriterTerms[termIndex % typewriterTerms.length];
    const isWordComplete = typedText === activeTerm;
    const isWordCleared = typedText.length === 0;
    const delay = isWordComplete && !isDeleting ? 1400 : isDeleting ? 30 : 70;

    const timer = window.setTimeout(() => {
      if (!isDeleting) {
        const nextValue = activeTerm.slice(0, typedText.length + 1);
        setTypedText(nextValue);
        if (nextValue === activeTerm) {
          setIsDeleting(true);
        }
        return;
      }

      const nextValue = activeTerm.slice(0, Math.max(typedText.length - 1, 0));
      setTypedText(nextValue);
      if (!nextValue && !isWordCleared) {
        setIsDeleting(false);
        setTermIndex((prev) => (prev + 1) % typewriterTerms.length);
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [typedText, termIndex, isDeleting, typewriterTerms]);

  useEffect(() => {
    const section = heroRef.current;
    if (!section) return undefined;

    if (!motionEnabled) {
      section.style.setProperty("--pointer-x", "0");
      section.style.setProperty("--pointer-y", "0");
      return undefined;
    }

    let frameId = null;
    const updatePointer = (clientX, clientY) => {
      const bounds = section.getBoundingClientRect();
      const px = ((clientX - bounds.left) / bounds.width - 0.5) * 2;
      const py = ((clientY - bounds.top) / bounds.height - 0.5) * 2;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        section.style.setProperty("--pointer-x", px.toFixed(4));
        section.style.setProperty("--pointer-y", py.toFixed(4));
      });
    };

    const handleMove = (event) => updatePointer(event.clientX, event.clientY);
    const handleLeave = () => {
      section.style.setProperty("--pointer-x", "0");
      section.style.setProperty("--pointer-y", "0");
    };

    section.addEventListener("mousemove", handleMove);
    section.addEventListener("mouseleave", handleLeave);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      section.removeEventListener("mousemove", handleMove);
      section.removeEventListener("mouseleave", handleLeave);
    };
  }, [motionEnabled]);

  useEffect(() => {
    const revealed = Array.from(document.querySelectorAll("[data-home-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -48px 0px" }
    );

    revealed.forEach((node, index) => {
      node.style.setProperty("--reveal-delay", `${Math.min(index, 10) * 120}ms`);
      observer.observe(node);
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tiltCards = Array.from(document.querySelectorAll("[data-home-tilt]"));

    if (!motionEnabled) {
      tiltCards.forEach((card) => {
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        card.style.setProperty("--tilt-lift", "0px");
      });
      return undefined;
    }

    const cleanups = tiltCards.map((card) => {
      let frameId = null;

      const handleMove = (event) => {
        const bounds = card.getBoundingClientRect();
        const relativeX = (event.clientX - bounds.left) / bounds.width;
        const relativeY = (event.clientY - bounds.top) / bounds.height;
        const rotateY = (relativeX - 0.5) * 8;
        const rotateX = (0.5 - relativeY) * 8;

        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }

        frameId = window.requestAnimationFrame(() => {
          card.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
          card.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
          card.style.setProperty("--tilt-lift", "-6px");
        });
      };

      const handleLeave = () => {
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        card.style.setProperty("--tilt-lift", "0px");
      };

      card.addEventListener("mousemove", handleMove);
      card.addEventListener("mouseleave", handleLeave);

      return () => {
        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }
        card.removeEventListener("mousemove", handleMove);
        card.removeEventListener("mouseleave", handleLeave);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [motionEnabled]);

  useEffect(() => {
    const magneticButtons = Array.from(document.querySelectorAll("[data-magnetic]"));

    if (!motionEnabled) {
      magneticButtons.forEach((button) => {
        button.style.transform = "translate3d(0, 0, 0)";
      });
      return undefined;
    }

    const cleanups = magneticButtons.map((button) => {
      let frameId = null;

      const handleMove = (event) => {
        const bounds = button.getBoundingClientRect();
        const offsetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 12;
        const offsetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 10;

        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }

        frameId = window.requestAnimationFrame(() => {
          button.style.transform = `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0)`;
        });
      };

      const handleLeave = () => {
        button.style.transform = "translate3d(0, 0, 0)";
      };

      button.addEventListener("mousemove", handleMove);
      button.addEventListener("mouseleave", handleLeave);

      return () => {
        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }
        button.removeEventListener("mousemove", handleMove);
        button.removeEventListener("mouseleave", handleLeave);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [motionEnabled]);

  const go = (role) => {
    const key = `gb_has_account_${role}`;
    const hasAccount = localStorage.getItem(key) === "1";
    if (hasAccount) {
      navigate(`/login/${role}`);
    } else {
      navigate(`/signup/${role}`);
    }
  };

  const handleGo = (role) => (event) => {
    applyRipple(event);
    window.requestAnimationFrame(() => go(role));
  };

  return (
    <section className={`home-hero ${motionEnabled ? "" : "motion-disabled"}`} ref={heroRef}>
      <div className="home-hero-media" aria-hidden="true">
        <div className="home-sky-wash" />
        <div className="home-halo home-halo-one" />
        <div className="home-halo home-halo-two" />
        <div className="home-halo home-halo-three" />
        <div className="home-hero-grid" />
        <div className="home-hero-noise" />

        <div className="home-floating-scene">
          {FLOATING_PIECES.map((piece) => (
            <span
              key={piece.id}
              className={`float-piece ${piece.type} ${piece.id}`}
              style={{ "--depth": piece.depth }}
            />
          ))}
        </div>
      </div>

      <div className="grain" aria-hidden="true" />

      <div className="home-hero-inner main-shell">
        <div className="home-hero-copy glass-panel reveal-up" data-home-tilt data-home-reveal>
          <div className="home-wordmark-row">
            <div className="home-hero-badge">
              <Sparkles size={14} />
              <span>GigBridge Curation</span>
            </div>
            <button
              type="button"
              className="home-motion-toggle"
              onClick={() => setMotionEnabled((prev) => !prev)}
            >
              {motionEnabled ? "Motion On" : "Motion Off"}
            </button>
          </div>

          <div className="home-hero-copy-stack">
            <p className="home-kicker" data-home-reveal>
              {HERO_CONTENT.kicker}
            </p>

            <h1 className="home-hero-title" data-home-reveal>
              {HERO_CONTENT.title}
              <span className="home-title-accent"> {HERO_CONTENT.titleAccent}</span>
            </h1>

            <p className="home-hero-subtitle" data-home-reveal>
              {HERO_CONTENT.subtitle}
            </p>
          </div>
          <div className="home-hero-buttons" data-home-reveal>
            <button className="home-primary-btn" data-magnetic onClick={handleGo("client")}>
              <span>{HERO_CONTENT.primaryButtonText}</span>
              <ArrowRight size={18} />
            </button>
            <button className="home-secondary-btn" data-magnetic onClick={handleGo("freelancer")}>
              <Play size={18} />
              <span>{HERO_CONTENT.secondaryButtonText}</span>
            </button>
          </div>
          {isAndroid ? (
            <div className="home-hero-buttons" data-home-reveal>
              <a className="home-secondary-btn" data-magnetic href="/apk/gigbridge.apk" download>
                <span>Download App</span>
              </a>
            </div>
          ) : (
            <p className="home-hero-subtitle" data-home-reveal>
              Please open this site on an Android device to install the app.
            </p>
          )}
        </div>

      </div>

      <div className="home-scroll-indicator" data-home-reveal>
        <span className="home-scroll-line" />
        <span>Scroll to explore</span>
      </div>
    </section>
  );
}