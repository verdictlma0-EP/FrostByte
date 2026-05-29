'use client';

import { useEffect, useState } from 'react';

const DOGE_PHRASES = [
  { text: 'wow', color: '#F5C542', top: '15%', left: '8%', delay: '0s', size: '1.4rem' },
  { text: 'such browser', color: '#a78bfa', top: '25%', left: '78%', delay: '0.3s', size: '1.1rem' },
  { text: 'very proxy', color: '#60a5fa', top: '70%', left: '12%', delay: '0.6s', size: '1rem' },
  { text: 'many speed', color: '#34d399', top: '60%', left: '80%', delay: '0.9s', size: '1.2rem' },
  { text: 'so fast', color: '#f472b6', top: '40%', left: '85%', delay: '1.2s', size: '0.95rem' },
  { text: 'amaze', color: '#F5C542', top: '80%', left: '55%', delay: '1.5s', size: '1.3rem' },
];

export default function BootScreen() {
  const [visible, setVisible] = useState(true);

  return (
    <div
      className="boot-screen"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease' }}
    >
      {/* Floating doge phrases */}
      {DOGE_PHRASES.map((p, i) => (
        <span
          key={i}
          className="doge-float font-comic"
          style={{
            top: p.top,
            left: p.left,
            color: p.color,
            fontSize: p.size,
            animationDelay: p.delay,
            animationDuration: `${5 + i * 0.7}s`,
            opacity: 0,
            animation: `floatDoge ${5 + i * 0.7}s ease-in-out ${p.delay} infinite`,
          }}
        >
          {p.text}
        </span>
      ))}

      {/* Center content */}
      <div style={{ textAlign: 'center', zIndex: 10 }}>
        {/* Logo/icon placeholder - replace with actual logo */}
        <div style={{
          width: 80, height: 80,
          borderRadius: 20,
          background: 'rgba(245,197,66,0.15)',
          border: '2px solid rgba(245,197,66,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          fontSize: 40,
        }}>
          🐕(I think this is a doge emoji)
        </div>

        <div className="boot-logo">FrostByte</div>

        <p className="font-comic" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', marginTop: 6 }}>
          such browser. very fast. wow.
        </p>

        <div className="boot-progress-bar" style={{ margin: '28px auto 0' }}>
          <div className="boot-progress-fill" />
        </div>

        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px', marginTop: 14, fontFamily: 'monospace' }}>
          FrostByte OS v2.0 — initializing much wow
        </p>
      </div>
    </div>
  );
}
