'use client';

import { useState, useEffect } from 'react';
import Desktop from '@/components/desktop/Desktop';
import AuthModal from '@/components/auth/AuthModal';
import BootScreen from '@/components/desktop/BootScreen';

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBooting(false);
      setShowAuth(true);
    }, 2800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="w-screen h-screen overflow-hidden">
      {booting && <BootScreen />}
      {!booting && !authed && showAuth && (
        <AuthModal onAuth={() => { setAuthed(true); setShowAuth(false); }} />
      )}
      {authed && <Desktop />}
    </main>
  );
}
