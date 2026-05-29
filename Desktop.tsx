'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Taskbar from '@/components/taskbar/Taskbar';
import BrowserWindow from '@/components/windows/BrowserWindow';
import SettingsWindow from '@/components/windows/SettingsWindow';
import ContextMenu from './ContextMenu';
import DogeFloaters from './DogeFloaters';

export type WindowDef = {
  id: string;
  type: 'browser' | 'settings' | 'youtube';
  title: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  zIndex: number;
};

// started with 1 wallpaper but it looked depressing so I decided on ts
const WALLPAPERS = ['wallpaper-1', 'wallpaper-2', 'wallpaper-3'];

let zCounter = 10;

export default function Desktop() {
  const [wallpaper, setWallpaper] = useState(0);
  const [windows, setWindows] = useState<WindowDef[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    // auto-open browser because people are gonna be thinking thinking the site froze on boot
    openWindow('browser');
  }, []);

  function openWindow(type: WindowDef['type']) {
    const id = `${type}-${Date.now()}`;
    zCounter += 1;

    const defaults: Record<WindowDef['type'], Partial<WindowDef>> = {
      browser: { title: 'FrostByte Browser', icon: '🌐', width: 900, height: 580 },
      settings: { title: 'Settings', icon: '⚙️', width: 560, height: 440 },
      youtube: { title: 'YouTube', icon: '▶️', width: 860, height: 540 },
    };

    // fake cascading effect because perfectly centered windows looked weird
    // btw if you think this is ai because of the emojis, read penalty cv portfolio page
    const offset = windows.length * 30;
    const w = defaults[type].width!;
    const h = defaults[type].height!;
    const x = Math.max(40, (window.innerWidth - w) / 2 + offset);
    const y = Math.max(40, (window.innerHeight - h - 52) / 2 + offset);

    setWindows(prev => [
      ...prev,
      { id, type, x, y, zIndex: zCounter, minimized: false, ...defaults[type] } as WindowDef,
    ]);
    setFocusedId(id);
  }

  function closeWindow(id: string) {
    setWindows(prev => prev.filter(w => w.id !== id));
    setFocusedId(null);
  }

  function minimizeWindow(id: string) {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: true } : w));
  }

  function focusWindow(id: string) {
    zCounter += 1;
    setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: zCounter, minimized: false } : w));
    setFocusedId(id);
  }

  function updateWindowPos(id: string, x: number, y: number) {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, x, y } : w));
  }

  function updateWindowSize(id: string, width: number, height: number) {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, width, height } : w));
  }

  function handleDesktopRightClick(e: React.MouseEvent) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      className={`${WALLPAPERS[wallpaper]} w-screen h-screen relative overflow-hidden`}
      onContextMenu={handleDesktopRightClick}
      onClick={() => setCtx(null)}
    >
      {/* Animated noise overlay */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.025, zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        pointerEvents: 'none',
      }} />

      {/* Maintenance banner */}
      {maintenanceMode && (
        <div className="maintenance-banner">
          🚧 wow. such maintenance. very temporary. doge/frostbyte is fixing things. 🚧
        </div>
      )}

      {/* Floating doge phrases on desktop */}
      <DogeFloaters />

      {/* Windows */}
      {windows.map(win => {
        if (win.minimized) return null;
        const isFocused = win.id === focusedId;

        const commonProps = {
          win,
          isFocused,
          onFocus: () => focusWindow(win.id),
          onClose: () => closeWindow(win.id),
          onMinimize: () => minimizeWindow(win.id),
          onMove: (x: number, y: number) => updateWindowPos(win.id, x, y),
          onResize: (w: number, h: number) => updateWindowSize(win.id, w, h),
        };

        if (win.type === 'browser' || win.type === 'youtube') {
          return <BrowserWindow key={win.id} {...commonProps} />;
        }
        if (win.type === 'settings') {
          return (
            <SettingsWindow
              key={win.id}
              {...commonProps}
              wallpaperIndex={wallpaper}
              onWallpaperChange={setWallpaper}
              maintenanceMode={maintenanceMode}
              onMaintenanceToggle={setMaintenanceMode}
            />
          );
        }
        return null;
      })}

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={[
            { label: 'New Browser', onClick: () => openWindow('browser') },
            { label: 'Settings', onClick: () => openWindow('settings') },
            { label: 'YouTube', onClick: () => openWindow('youtube') },
            { separator: true },
            { label: ' Shuffle Wallpaper', onClick: () => setWallpaper(v => (v + 1) % WALLPAPERS.length) },
          ]}
        />
      )}

      {/* Taskbar */}
      <Taskbar
        windows={windows}
        focusedId={focusedId}
        onFocus={focusWindow}
        onOpenBrowser={() => openWindow('browser')}
        onOpenSettings={() => openWindow('settings')}
        onOpenYoutube={() => openWindow('youtube')}
      />
    </div>
  );
}
