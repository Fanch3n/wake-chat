/**
 * Light/dark theme toggle. The page follows the OS setting until the user
 * picks a theme; the saved choice is applied before first paint by the inline
 * script in index.html.
 */
import { $ } from './dom.js';

const THEME_KEY = 'wake-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const systemTheme = () => (darkQuery.matches ? 'dark' : 'light');
const currentTheme = () => document.documentElement.dataset.theme || systemTheme();

function updateButton() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;
  $('theme-btn').title = label;
  $('theme-btn').setAttribute('aria-label', label);
  $('theme-icon').setAttribute('href', next === 'dark' ? '#i-moon' : '#i-sun');
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  // Only remember a choice that differs from the OS setting, so the page
  // follows the OS again once the user switches back to it
  if (next === systemTheme()) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = next;
  }
  try {
    if (next === systemTheme()) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    // Storage may be unavailable (private mode); the choice then lasts for this page only
  }
  updateButton();
}

export function initTheme() {
  updateButton();
  $('theme-btn').addEventListener('click', toggleTheme);
  darkQuery.addEventListener('change', updateButton);
}
