import { useEffect, useState } from 'react';

/**
 * Theme registry. A theme is a block of CSS tokens selected by <html data-theme="id">
 * (see styles.css, themes.css and docs/THEMING.md). List it here so it shows in Account > Theme.
 */
export interface ThemeDef {
  id: string;
  label: string;
  description: string;
  scheme: 'light' | 'dark';
  /** The light theme to print with, for a dark theme. */
  printAs?: string;
}

export const THEMES: ThemeDef[] = [
  { id: 'classic', label: 'Classic 3.1', description: 'The original grey binder with bevelled buttons.', scheme: 'light' },
  { id: 'modern-light', label: 'Modern light', description: 'Flat paper pages, the same coloured tabs.', scheme: 'light' },
  { id: 'modern-dark', label: 'Modern dark', description: 'Easier on the eyes at night.', scheme: 'dark', printAs: 'modern-light' },
];

/** "auto" follows the device: these are the themes it picks. */
export const AUTO = 'auto';
const AUTO_LIGHT = 'modern-light';
const AUTO_DARK = 'modern-dark';

const deviceDark = window.matchMedia('(prefers-color-scheme: dark)');
const known = (id: string) => THEMES.find((t) => t.id === id);

/** A stored choice ("auto" or a theme id) -> the theme actually shown. Unknown ids fall back to "auto". */
export function resolveTheme(choice: string | null | undefined): ThemeDef {
  return (choice && known(choice)) || known(deviceDark.matches ? AUTO_DARK : AUTO_LIGHT)!;
}

const STORE_KEY = 'ks.theme';
/** Last choice used in this browser, so the sign-in screen matches before anyone has signed in. */
export function storedTheme(): string {
  try { return localStorage.getItem(STORE_KEY) || AUTO; } catch { return AUTO; }
}

export function applyTheme(choice: string | null | undefined): ThemeDef {
  const theme = resolveTheme(choice);
  document.documentElement.dataset.theme = theme.id;
  return theme;
}

/** Keeps <html data-theme> in step with the user's choice, the device setting and printing. Returns the theme shown. */
export function useTheme(choice: string | null | undefined): ThemeDef {
  const [theme, setTheme] = useState(() => applyTheme(choice ?? storedTheme()));
  useEffect(() => {
    const wanted = choice ?? storedTheme();
    if (choice) { try { localStorage.setItem(STORE_KEY, choice); } catch { /* private mode */ } }
    const update = () => setTheme(applyTheme(wanted));
    update();
    const beforePrint = () => { const t = resolveTheme(wanted); if (t.printAs) document.documentElement.dataset.theme = t.printAs; };
    deviceDark.addEventListener('change', update);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', update);
    return () => {
      deviceDark.removeEventListener('change', update);
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', update);
    };
  }, [choice]);
  return theme;
}
