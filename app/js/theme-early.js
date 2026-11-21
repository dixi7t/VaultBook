/* Apply the saved appearance before first paint (no flash of the wrong theme). Loaded in <head>. */
try { var p = JSON.parse(localStorage.getItem('OfflineBooksUS.prefs.v1') || '{}'), d = document.documentElement;
  if (p.theme === 'light' || p.theme === 'dark') d.dataset.theme = p.theme;
  if (p.density === 'compact') d.dataset.density = 'compact';
  if (p.sidebarCollapsed !== false) d.classList.add('sidebar-collapsed');
  if (p.navCompact) d.classList.add('nav-compact'); } catch (e) {}
