'use client';
// src/app/page.jsx — QuietKeep Homepage v4 "Aurora"
// Light-first, cosmetic-rich, clear Personal ↔ Business split.
// Self-contained: all styling is in the <style jsx global> block below so
// this file touches NO shared CSS and NO personal/business app logic.
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/context/auth';

// ── Animated counter ─────────────────────────────────────────────
function Counter({ target, suffix = '' }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = target / 60;
      const t = setInterval(() => {
        start = Math.min(start + step, target);
        setCount(Math.floor(start));
        if (start >= target) clearInterval(t);
      }, 16);
    }, { threshold: 0.2 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{count.toLocaleString('en-IN')}{suffix}</span>;
}

const PERSONAL_FEATURES = [
  { emoji: '🎙️', hue: '#6366f1', title: 'Voice-First Keeps', desc: 'Say it once — transcribed, tagged, stored. Hindi, Telugu, Tamil & English.' },
  { emoji: '☀️', hue: '#f59e0b', title: 'Daily Brief', desc: 'A spoken morning card: reminders, calendar, weather, Panchangam, nudges.' },
  { emoji: '⏰', hue: '#ec4899', title: 'Reminders That Act', desc: '“Call dad Sunday” → set. It speaks the reminder aloud — not just a buzz.' },
  { emoji: '🛡️', hue: '#10b981', title: 'Warranty Wallet', desc: 'WhatsApp an invoice photo → product auto-added. Track warranties & best replace time.' },
  { emoji: '📅', hue: '#8b5cf6', title: 'Indian Calendar', desc: 'Tithi, Nakshatra, Telugu / Hindi / Tamil / Islamic — over your own calendar.' },
  { emoji: '👨‍👩‍👧', hue: '#0ea5e9', title: 'Family Space', desc: 'Shared keeps, kids profiles with PIN lock, emergency contacts & location.' },
];

const BUSINESS_FEATURES = [
  { emoji: '📷', hue: '#6366f1', title: 'One Scanner', desc: 'One camera reads barcodes, UPI QRs & invoices — and routes by what it sees.' },
  { emoji: '🔊', hue: '#10b981', title: 'Spoken Payment Confirm', desc: 'Dynamic UPI QR → webhook-verified “₹500 received from Ramesh”, aloud. Kills fake screenshots.' },
  { emoji: '📒', hue: '#f59e0b', title: 'Voice Ledger & GST', desc: '“Do Parle-G, ek Surf” → GST-correct bill. Khata by voice, in your language.' },
  { emoji: '📦', hue: '#ec4899', title: 'Live Inventory', desc: 'Every sale decrements stock. Low-stock alerts and reorder lists, hands-free.' },
  { emoji: '🧑‍🤝‍🧑', hue: '#8b5cf6', title: 'People & Ops Brain', desc: 'Attendance, task assignment, follow-up nudges — for service & ops businesses, no cash counter needed.' },
  { emoji: '🏢', hue: '#0ea5e9', title: 'Kirana → Corporate', desc: 'Starts as a shop khata, scales to multi-branch roles, approvals & GST reports.' },
];

const SECTORS = [
  { icon: '🏪', name: 'Retail & Kirana' }, { icon: '🍽️', name: 'Restaurant' },
  { icon: '✂️', name: 'Salon & Services' }, { icon: '🏥', name: 'Clinic & Pharmacy' },
  { icon: '📚', name: 'Coaching & Schools' }, { icon: '🚚', name: 'Logistics' },
  { icon: '🏗️', name: 'Construction' }, { icon: '🏢', name: 'Corporate Ops' },
];

const STEPS = [
  { n: '1', title: 'Wake it', desc: 'Long-press, tap the widget, or say “Aaria” at the counter. No app-hunting.' },
  { n: '2', title: 'Just talk', desc: 'Natural language in your language. It understands intent, not keywords.' },
  { n: '3', title: 'It does the task', desc: 'Sets alarms, sends WhatsApp, books the entry, confirms the payment — then tells you.' },
  { n: '4', title: 'It learns you', desc: 'After a week it anticipates: the follow-up, the reorder, the morning brief you always want.' },
];

export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState('personal');

  // Native APK users skip the marketing page.
  useEffect(() => {
    const isNative = typeof window !== 'undefined'
      && window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();
    if (isNative) {
      router.replace(user ? '/dashboard' : '/login');
    }
  }, [user, router]);

  const isBiz = mode === 'business';

  return (
    <div className="qk-home" data-mode={mode}>
      {/* ───── Aurora background ───── */}
      <div className="aurora" aria-hidden>
        <span className="blob b1" /><span className="blob b2" /><span className="blob b3" />
        <span className="spark s1" /><span className="spark s2" /><span className="spark s3" />
        <span className="spark s4" /><span className="spark s5" />
      </div>

      {/* ───── Nav ───── */}
      <nav className="nav">
        <Link href="/" className="brand">
          <span className="brand-orb">◕‿◕</span>
          <span className="brand-name">QuietKeep</span>
        </Link>
        <div className="nav-links">
          <a href="#personal" onClick={() => setMode('personal')}>Personal</a>
          <a href="#business" onClick={() => setMode('business')}>Business</a>
          <a href="#how">How it works</a>
          <Link href={user ? '/dashboard' : '/login'} className="nav-cta">
            {user ? 'Open app' : 'Sign in'}
          </Link>
        </div>
      </nav>

      {/* ───── Hero ───── */}
      <header className="hero">
        <div className="hero-copy">
          <div className="pill">🌸 Voice that acts — not just answers</div>
          <h1>
            Meet <span className="grad">Aaria</span>.<br />
            Your voice does the work now.
          </h1>
          <p className="sub">
            Siri and Alexa reply. QuietKeep <b>acts</b> — it sets the reminder and speaks it back,
            sends the WhatsApp, confirms the payment, and after a week it starts doing things before you ask.
            One assistant, two lives: your home and your business.
          </p>

          {/* Mode switch */}
          <div className="switch" role="tablist">
            <button className={!isBiz ? 'on' : ''} onClick={() => setMode('personal')}>🏡 Personal</button>
            <button className={isBiz ? 'on' : ''} onClick={() => setMode('business')}>🧾 Business</button>
            <span className="switch-thumb" style={{ transform: isBiz ? 'translateX(100%)' : 'translateX(0)' }} />
          </div>

          <div className="hero-cta">
            <Link href={user ? '/dashboard' : '/login'} className="btn primary">
              {isBiz ? 'Start my business' : 'Start free'} →
            </Link>
            <a href={isBiz ? '#business' : '#personal'} className="btn ghost">See {isBiz ? 'business' : 'personal'} features</a>
          </div>

          <div className="stats">
            <div><strong><Counter target={4} /></strong><span>languages</span></div>
            <div><strong>&lt;<Counter target={2} />s</strong><span>voice → action</span></div>
            <div><strong><Counter target={100} suffix="%" /></strong><span>hands-free</span></div>
          </div>
        </div>

        {/* ── Anime widget: floating phone with a living assistant ── */}
        <div className="hero-art">
          <div className="phone">
            <div className="phone-notch" />
            <div className="assistant-face">
              <div className="eyes"><span /><span /></div>
              <div className="mouth" />
              <div className="ring" /><div className="ring r2" />
            </div>
            <div className="bubble bubble-in">“Remind me to pay Suresh ₹4,000 tomorrow”</div>
            <div className="bubble bubble-out">Done ✓ I’ll say it out loud at 10am.</div>
            <div className="wave"><span /><span /><span /><span /><span /><span /><span /></div>
          </div>
          <div className="mini-card mc1">☀️ Good morning! 3 reminders, ₹2,400 due today.</div>
          <div className="mini-card mc2">🔊 “₹500 received from Ramesh”</div>
          <div className="mini-card mc3">📦 Parle-G low — reorder?</div>
        </div>
      </header>

      {/* ───── Feature band (mode-aware) ───── */}
      <section id={isBiz ? 'business' : 'personal'} className="band">
        <div className="band-head">
          <span className="eyebrow">{isBiz ? 'QuietKeep for Business' : 'QuietKeep for You'}</span>
          <h2>{isBiz ? 'One quiet scanner for the whole shop' : 'A personal assistant that actually helps'}</h2>
          <p>{isBiz
            ? 'Payments, inventory, billing and people — unified. From a single-counter kirana to a multi-branch operation.'
            : 'Wake word, proactive reminders, pattern learning. It remembers how you live and gets ahead of it.'}</p>
        </div>
        <div className="grid">
          {(isBiz ? BUSINESS_FEATURES : PERSONAL_FEATURES).map((f) => (
            <article key={f.title} className="fcard" style={{ '--hue': f.hue }}>
              <div className="fcard-orb">{f.emoji}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <span className="fcard-glow" />
            </article>
          ))}
        </div>
      </section>

      {/* ───── How it works ───── */}
      <section id="how" className="how">
        <span className="eyebrow center">The difference</span>
        <h2 className="center">Reply is easy. Doing is the point.</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div key={s.n} className="step">
              <div className="step-n">{s.n}</div>
              <h4>{s.title}</h4>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Sectors ───── */}
      <section className="sectors">
        <span className="eyebrow center">Built for every business</span>
        <h2 className="center">Cash counter or people-only — it fits</h2>
        <div className="chips">
          {SECTORS.map((s) => (
            <div key={s.name} className="chip"><span>{s.icon}</span>{s.name}</div>
          ))}
        </div>
      </section>

      {/* ───── Aaria callout ───── */}
      <section className="callout">
        <div className="callout-orb"><span className="eyes"><span /><span /></span><span className="mouth" /></div>
        <div>
          <h2>“Aaria, take care of it.”</h2>
          <p>The multilingual voice engine inside every QuietKeep — proactive, offline-capable, and made for Indian voices.</p>
          <Link href={user ? '/dashboard' : '/login'} className="btn primary">Try it free →</Link>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className="foot">
        <div className="foot-brand"><span className="brand-orb">◕‿◕</span> QuietKeep</div>
        <div className="foot-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/trust">Trust</Link>
        </div>
        <div className="foot-fine">A Pranix AI Labs product · Made in India 🇮🇳</div>
      </footer>

      {/* ───────────────────────── styles ───────────────────────── */}
      <style jsx global>{`
        .qk-home{--p:#6366f1;--p2:#8b5cf6;--acc:#10b981;position:relative;overflow:hidden;
          color:#1e293b;background:
            radial-gradient(1200px 700px at 80% -5%, #eef1ff 0%, transparent 55%),
            radial-gradient(900px 600px at 0% 20%, #fdf0ff 0%, transparent 50%),
            linear-gradient(180deg,#f7f8ff 0%,#f4f6fb 100%);min-height:100dvh;}
        .qk-home[data-mode="business"]{--p:#0e9f6e;--p2:#10b981;--acc:#6366f1;}
        .qk-home *{box-sizing:border-box}

        /* aurora */
        .aurora{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
        .blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.5;animation:float 18s ease-in-out infinite}
        .b1{width:420px;height:420px;background:radial-gradient(circle,#a5b4fc,#c7d2fe 60%,transparent);top:-120px;right:-80px}
        .b2{width:380px;height:380px;background:radial-gradient(circle,#fbcfe8,#f5d0fe 60%,transparent);top:40%;left:-120px;animation-delay:-6s}
        .b3{width:340px;height:340px;background:radial-gradient(circle,#a7f3d0,#bae6fd 60%,transparent);bottom:-100px;right:20%;animation-delay:-11s}
        .spark{position:absolute;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 12px 3px rgba(139,92,246,.6);animation:twinkle 4s ease-in-out infinite}
        .s1{top:18%;left:22%}.s2{top:30%;right:28%;animation-delay:-1s}.s3{top:62%;left:14%;animation-delay:-2s}
        .s4{top:74%;right:18%;animation-delay:-1.5s}.s5{top:46%;left:52%;animation-delay:-2.5s}
        @keyframes float{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(24px,-28px) scale(1.08)}}
        @keyframes twinkle{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1.2)}}

        .nav,.hero,.band,.how,.sectors,.callout,.foot{position:relative;z-index:1}
        .nav{max-width:1180px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}
        .brand{display:flex;align-items:center;gap:10px;text-decoration:none}
        .brand-orb{font-size:15px;color:#fff;background:linear-gradient(135deg,var(--p),var(--p2));width:38px;height:38px;
          border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(99,102,241,.35);letter-spacing:-1px}
        .brand-name{font-weight:800;font-size:19px;letter-spacing:-.4px;color:#1e293b}
        .nav-links{display:flex;align-items:center;gap:26px}
        .nav-links a{color:#475569;text-decoration:none;font-weight:600;font-size:14px;transition:.2s}
        .nav-links a:hover{color:var(--p)}
        .nav-cta{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff!important;padding:9px 18px;border-radius:11px;box-shadow:0 6px 18px rgba(99,102,241,.3)}
        @media(max-width:720px){.nav-links a:not(.nav-cta){display:none}}

        .hero{max-width:1180px;margin:0 auto;padding:36px 24px 40px;display:grid;grid-template-columns:1.05fr .95fr;gap:40px;align-items:center}
        @media(max-width:900px){.hero{grid-template-columns:1fr;padding-top:12px}.hero-art{order:-1}}
        .pill{display:inline-flex;gap:8px;align-items:center;background:#fff;border:1px solid rgba(99,102,241,.18);
          color:var(--p);font-weight:700;font-size:13px;padding:8px 15px;border-radius:999px;box-shadow:0 4px 14px rgba(99,102,241,.1)}
        .hero h1{font-size:clamp(34px,5vw,54px);line-height:1.05;font-weight:800;letter-spacing:-1.5px;margin:18px 0 0}
        .grad{background:linear-gradient(120deg,var(--p),var(--p2) 55%,var(--acc));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
        .sub{color:#475569;font-size:17px;line-height:1.6;margin:18px 0 22px;max-width:560px}
        .sub b{color:#1e293b}

        .switch{position:relative;display:inline-flex;background:#eef0f8;border-radius:14px;padding:5px;margin-bottom:22px}
        .switch button{position:relative;z-index:2;border:0;background:transparent;font-weight:700;font-size:14px;color:#64748b;padding:9px 20px;border-radius:10px;cursor:pointer;transition:color .2s}
        .switch button.on{color:#1e293b}
        .switch-thumb{position:absolute;top:5px;left:5px;width:calc(50% - 5px);height:calc(100% - 10px);background:#fff;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.1);transition:transform .28s cubic-bezier(.4,0,.2,1);z-index:1}

        .hero-cta{display:flex;gap:12px;flex-wrap:wrap}
        .btn{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:13px 24px;border-radius:13px;text-decoration:none;transition:.2s;cursor:pointer;border:0}
        .btn.primary{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;box-shadow:0 10px 26px rgba(99,102,241,.32)}
        .btn.primary:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(99,102,241,.4)}
        .btn.ghost{background:#fff;color:#334155;border:1px solid rgba(0,0,0,.09);box-shadow:0 3px 12px rgba(0,0,0,.05)}
        .btn.ghost:hover{border-color:var(--p);color:var(--p)}

        .stats{display:flex;gap:30px;margin-top:30px}
        .stats strong{font-size:26px;font-weight:800;color:#1e293b;display:block}
        .stats span{font-size:13px;color:#64748b}

        /* phone widget */
        .hero-art{position:relative;display:flex;justify-content:center;align-items:center;min-height:440px}
        .phone{position:relative;width:270px;height:400px;border-radius:38px;background:linear-gradient(160deg,#ffffff,#f1f4ff);
          border:1px solid rgba(0,0,0,.06);box-shadow:0 30px 60px rgba(80,90,160,.28),inset 0 0 0 6px #fff;padding:26px 20px;animation:bob 6s ease-in-out infinite}
        @keyframes bob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-14px) rotate(1.5deg)}}
        .phone-notch{width:90px;height:7px;border-radius:99px;background:#dfe3f0;margin:0 auto 20px}
        .assistant-face{position:relative;width:96px;height:96px;margin:6px auto 18px;border-radius:50%;
          background:linear-gradient(145deg,var(--p),var(--p2));box-shadow:0 12px 30px rgba(99,102,241,.4)}
        .assistant-face .eyes{position:absolute;top:38px;left:0;right:0;display:flex;justify-content:center;gap:18px}
        .assistant-face .eyes span{width:11px;height:11px;background:#fff;border-radius:50%;animation:blink 4s infinite}
        .assistant-face .mouth{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);width:26px;height:13px;border-radius:0 0 20px 20px;background:#fff}
        @keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
        .assistant-face .ring{position:absolute;inset:-8px;border-radius:50%;border:2px solid rgba(99,102,241,.35);animation:pulse 2.6s ease-out infinite}
        .assistant-face .ring.r2{animation-delay:1.3s}
        @keyframes pulse{0%{transform:scale(.9);opacity:.8}100%{transform:scale(1.5);opacity:0}}
        .bubble{font-size:12.5px;line-height:1.4;padding:10px 13px;border-radius:14px;margin:8px 0;max-width:92%}
        .bubble-in{background:#eef0fb;color:#334155;border-bottom-left-radius:4px}
        .bubble-out{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;border-bottom-right-radius:4px;margin-left:auto}
        .wave{display:flex;gap:4px;justify-content:center;align-items:flex-end;height:26px;margin-top:12px}
        .wave span{width:4px;background:linear-gradient(var(--p),var(--p2));border-radius:99px;animation:eq 1s ease-in-out infinite}
        .wave span:nth-child(1){height:8px;animation-delay:0s}.wave span:nth-child(2){height:18px;animation-delay:.1s}
        .wave span:nth-child(3){height:26px;animation-delay:.2s}.wave span:nth-child(4){height:14px;animation-delay:.3s}
        .wave span:nth-child(5){height:22px;animation-delay:.4s}.wave span:nth-child(6){height:10px;animation-delay:.5s}.wave span:nth-child(7){height:16px;animation-delay:.6s}
        @keyframes eq{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}
        .mini-card{position:absolute;background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:14px;padding:11px 14px;font-size:12.5px;font-weight:600;color:#334155;box-shadow:0 12px 28px rgba(80,90,160,.18);animation:drift 7s ease-in-out infinite}
        .mc1{top:6%;left:-6%;animation-delay:0s}
        .mc2{bottom:20%;right:-10%;animation-delay:-2.3s;color:var(--acc)}
        .mc3{bottom:2%;left:-2%;animation-delay:-4.6s}
        @keyframes drift{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @media(max-width:900px){.mc1{left:2%}.mc2{right:2%}.mc3{left:4%}}

        /* bands */
        .band{max-width:1180px;margin:0 auto;padding:60px 24px}
        .band-head{max-width:640px;margin:0 auto 40px;text-align:center}
        .eyebrow{display:inline-block;font-weight:800;font-size:12.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--p);margin-bottom:12px}
        .eyebrow.center,.center{text-align:center}
        h2{font-size:clamp(26px,3.4vw,38px);font-weight:800;letter-spacing:-.8px;margin:0 0 12px}
        .band-head p,.how>p{color:#64748b;font-size:16px;line-height:1.6}
        .how h2.center,.sectors h2.center{margin-left:auto;margin-right:auto;max-width:720px}

        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
        @media(max-width:860px){.grid{grid-template-columns:1fr 1fr}}
        @media(max-width:560px){.grid{grid-template-columns:1fr}}
        .fcard{position:relative;background:rgba(255,255,255,.8);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.9);
          border-radius:20px;padding:26px 22px;box-shadow:0 10px 30px rgba(80,90,160,.1);overflow:hidden;transition:.25s}
        .fcard:hover{transform:translateY(-5px);box-shadow:0 20px 44px rgba(80,90,160,.18)}
        .fcard-orb{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px;
          background:color-mix(in srgb,var(--hue) 16%,#fff);box-shadow:0 8px 20px color-mix(in srgb,var(--hue) 30%,transparent);margin-bottom:16px}
        .fcard h3{font-size:18px;font-weight:800;margin:0 0 8px;letter-spacing:-.3px}
        .fcard p{color:#64748b;font-size:14.5px;line-height:1.55;margin:0}
        .fcard-glow{position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,var(--hue),transparent 70%);opacity:.16;pointer-events:none}

        /* steps */
        .how{max-width:1180px;margin:0 auto;padding:50px 24px}
        .steps{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:38px}
        @media(max-width:820px){.steps{grid-template-columns:1fr 1fr}}
        @media(max-width:460px){.steps{grid-template-columns:1fr}}
        .step{background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:18px;padding:24px 20px;box-shadow:0 8px 24px rgba(80,90,160,.08)}
        .step-n{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
        .step h4{font-size:16.5px;font-weight:800;margin:0 0 6px}
        .step p{color:#64748b;font-size:14px;line-height:1.5;margin:0}

        /* sectors */
        .sectors{max-width:1180px;margin:0 auto;padding:50px 24px}
        .chips{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:32px}
        .chip{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid rgba(0,0,0,.07);border-radius:999px;padding:11px 20px;font-weight:700;font-size:14px;color:#334155;box-shadow:0 4px 14px rgba(80,90,160,.08);transition:.2s}
        .chip:hover{transform:translateY(-3px);border-color:var(--p);color:var(--p)}
        .chip span{font-size:18px}

        /* callout */
        .callout{max-width:1000px;margin:40px auto 20px;padding:44px 34px;display:flex;align-items:center;gap:32px;flex-wrap:wrap;justify-content:center;text-align:left;
          background:linear-gradient(135deg,color-mix(in srgb,var(--p) 12%,#fff),color-mix(in srgb,var(--p2) 12%,#fff));
          border:1px solid rgba(255,255,255,.8);border-radius:28px;box-shadow:0 20px 50px rgba(80,90,160,.16)}
        .callout-orb{position:relative;width:110px;height:110px;border-radius:50%;flex:none;background:linear-gradient(145deg,var(--p),var(--p2));box-shadow:0 16px 36px rgba(99,102,241,.4)}
        .callout-orb .eyes{position:absolute;top:44px;left:0;right:0;display:flex;justify-content:center;gap:20px}
        .callout-orb .eyes span{width:12px;height:12px;background:#fff;border-radius:50%;animation:blink 4s infinite}
        .callout-orb .mouth{position:absolute;bottom:32px;left:50%;transform:translateX(-50%);width:30px;height:15px;border-radius:0 0 22px 22px;background:#fff}
        .callout h2{margin-bottom:8px}
        .callout p{color:#475569;font-size:16px;line-height:1.6;margin:0 0 18px;max-width:460px}

        /* footer */
        .foot{max-width:1180px;margin:0 auto;padding:40px 24px 56px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
        .foot-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px}
        .foot-links{display:flex;gap:24px;flex-wrap:wrap;justify-content:center}
        .foot-links a{color:#64748b;text-decoration:none;font-weight:600;font-size:14px}
        .foot-links a:hover{color:var(--p)}
        .foot-fine{color:#94a3b8;font-size:13px}
      `}</style>
    </div>
  );
}
