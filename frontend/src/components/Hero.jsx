import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Camera,
  Music2,
  Palette,
  Play,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import illustratorArt from "../assets/onboarding/illustrator.svg";
import musicianArt from "../assets/onboarding/musician.svg";
import painterArt from "../assets/onboarding/painter.svg";
import photographerArt from "../assets/onboarding/photographer.svg";

const TYPEWRITER_TERMS = [
  "illustrators with cinematic portfolios",
  "musicians for immersive live sets",
  "photographers with editorial polish",
  "painters for bold visual storytelling",
];

const SHOWCASE_CARDS = [
  {
    title: "Illustrators",
    subtitle: "Editorial, concept, and brand worlds",
    image: illustratorArt,
    icon: Palette,
  },
  {
    title: "Musicians",
    subtitle: "Live performers and studio-ready talent",
    image: musicianArt,
    icon: Music2,
  },
  {
    title: "Photographers",
    subtitle: "Campaign shoots and visual direction",
    image: photographerArt,
    icon: Camera,
  },
];

const PROOF_POINTS = [
  "Premium creative matching",
  "Verified artist-first profiles",
  "Fast, secure collaboration flow",
];

function buildParticles() {
  return Array.from({ length: 18 }, (_, index) => ({
    id: index,
    size: 8 + (index % 5) * 4,
    left: 4 + ((index * 11) % 88),
    top: 8 + ((index * 13) % 76),
    duration: 8 + (index % 6) * 1.4,
    delay: (index % 7) * 0.55,
  }));
}

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
  const particles = useMemo(buildParticles, []);
  const [videoReady, setVideoReady] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [termIndex, setTermIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

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
    const activeTerm = TYPEWRITER_TERMS[termIndex % TYPEWRITER_TERMS.length];
    const isWordComplete = typedText === activeTerm;
    const isWordCleared = typedText.length === 0;
    const delay = isWordComplete && !isDeleting ? 1350 : isDeleting ? 32 : 72;

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
        setTermIndex((prev) => (prev + 1) % TYPEWRITER_TERMS.length);
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [typedText, termIndex, isDeleting]);

  useEffect(() => {
    const section = heroRef.current;
    if (!section) return undefined;

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
  }, []);

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
      node.style.setProperty("--reveal-delay", `${Math.min(index, 8) * 90}ms`);
      observer.observe(node);
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tiltCards = Array.from(document.querySelectorAll("[data-home-tilt]"));

    const cleanups = tiltCards.map((card) => {
      let frameId = null;

      const handleMove = (event) => {
        const bounds = card.getBoundingClientRect();
        const relativeX = (event.clientX - bounds.left) / bounds.width;
        const relativeY = (event.clientY - bounds.top) / bounds.height;
        const rotateY = (relativeX - 0.5) * 10;
        const rotateX = (0.5 - relativeY) * 10;

        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }

        frameId = window.requestAnimationFrame(() => {
          card.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
          card.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
          card.style.setProperty("--tilt-lift", "-8px");
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
  }, []);

  useEffect(() => {
    const magneticButtons = Array.from(document.querySelectorAll("[data-magnetic]"));

    const cleanups = magneticButtons.map((button) => {
      let frameId = null;

      const handleMove = (event) => {
        const bounds = button.getBoundingClientRect();
        const offsetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 16;
        const offsetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 14;

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
  }, []);

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
    <section className="home-hero" ref={heroRef}>
      <div className="home-hero-media" aria-hidden="true">
        <div className="home-hero-poster-wrap">
          <img
            src="/assets/hero-image.png"
            alt=""
            className="home-hero-poster"
          />
          <video
            className={`home-hero-video${videoReady ? " is-ready" : ""}`}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onCanPlay={() => setVideoReady(true)}
            onError={() => setVideoReady(false)}
          >
            <source
              src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm"
              type="video/webm"
            />
            <source
              src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
              type="video/mp4"
            />
          </video>
        </div>
        <div className="home-hero-gradient" />
        <div className="home-hero-grid" />
        <div className="home-hero-noise" />
        <div className="home-blob home-blob-one" />
        <div className="home-blob home-blob-two" />
        <div className="home-blob home-blob-three" />
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="home-particle"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              animationDuration: `${particle.duration}s`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="home-hero-inner">
        <div className="home-hero-copy glass-panel" data-home-tilt data-home-reveal>
          <div className="home-hero-badge" data-home-reveal>
            <Sparkles size={16} />
            <span>#1 Platform for Creative Talent</span>
          </div>

          <h1 className="home-hero-title" data-home-reveal>
            Hire visionary artists for
            <span className="home-title-accent"> unforgettable creative work.</span>
          </h1>

          <p className="home-hero-subtitle" data-home-reveal>
            Connect with premium illustrators, musicians, painters, photographers,
            and performers through a cinematic discovery experience built for modern creative teams.
          </p>

          <div className="home-hero-search" data-home-reveal>
            <Search size={18} />
            <span className="home-search-prefix">Discover</span>
            <span className="home-search-typewriter">{typedText}</span>
            <span className="home-search-caret" />
          </div>

          <div className="home-hero-buttons" data-home-reveal>
            <button className="home-primary-btn" data-magnetic onClick={handleGo("client")}>
              <span>Hire a Freelancer</span>
              <ArrowRight size={18} />
            </button>
            <button className="home-secondary-btn" data-magnetic onClick={handleGo("freelancer")}>
              <Play size={18} />
              <span>Become an Artist</span>
            </button>
          </div>

          <div className="home-proof-pills" data-home-reveal>
            {PROOF_POINTS.map((item) => (
              <span key={item} className="home-proof-pill">
                <Star size={14} />
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="home-hero-stage">
          <div className="home-stage-card glass-panel" data-home-tilt data-home-reveal>
            <div className="home-stage-header">
              <div className="home-stage-header-pill">
                <Sparkles size={14} />
                <span>Creative Match Feed</span>
              </div>
              <div className="home-stage-header-meta">Realtime discovery</div>
            </div>

            <div className="home-stage-grid">
              {SHOWCASE_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <article key={card.title} className="home-stage-item">
                    <div className="home-stage-item-visual">
                      <img src={card.image} alt={`${card.title} illustration`} />
                    </div>
                    <div className="home-stage-item-copy">
                      <span className="home-stage-item-icon">
                        <Icon size={16} />
                      </span>
                      <div>
                        <h3>{card.title}</h3>
                        <p>{card.subtitle}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="home-float-card home-float-card-top glass-panel" data-home-tilt data-home-reveal>
            <div className="home-float-label">AI Search</div>
            <p>Smart artist ranking with faster matching for style, availability, and verified trust.</p>
          </div>

          <div className="home-float-card home-float-card-bottom glass-panel" data-home-tilt data-home-reveal>
            <div className="home-float-avatars">
              <img src={painterArt} alt="Painter artwork" />
              <img src={musicianArt} alt="Musician artwork" />
            </div>
            <div>
              <div className="home-float-label">Artist-ready workflow</div>
              <p>From discovery to payment, every step is designed to feel premium and frictionless.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="home-scroll-indicator" data-home-reveal>
        <span className="home-scroll-line" />
        <span>Scroll to explore</span>
      </div>
    </section>
  );
}
