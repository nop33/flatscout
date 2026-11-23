// "Install app" button in the top bar.
// - Android / Chrome / Edge: opens the browser's own install prompt.
// - iPhone / iPad: there is no install prompt, so it shows Add to Home Screen steps.
// - Hidden when the site is already running from the home screen.
(() => {
  const button = document.getElementById('install');
  const help = document.getElementById('install-help');
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let prompt = null;

  if (installed()) return;
  if (isIOS) button.hidden = false;

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    button.hidden = false;
  });
  addEventListener('appinstalled', () => { prompt = null; button.hidden = true; });

  const openHelp = () => { help.hidden = false; help.querySelector('.sheet-close').focus(); };
  const closeHelp = () => { help.hidden = true; button.focus(); };

  button.addEventListener('click', async () => {
    if (prompt) {
      prompt.prompt();
      await prompt.userChoice;
      // A prompt can only be used once. Chrome sends a new one if it can be offered again.
      prompt = null;
      button.hidden = true;
      return;
    }
    if (isIOS) openHelp();
  });
  help.addEventListener('click', (e) => {
    if (e.target === help || e.target.closest('.sheet-close')) closeHelp();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !help.hidden) closeHelp(); });
})();
