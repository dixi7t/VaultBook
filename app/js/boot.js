/* Start VaultBook once the passcode screen (gate.js) is unlocked. Loaded last. */
VBGate.ready.then(function () { OB.ui.start(); OB.windows.init(); });
/* buttons marked data-print open the browser's print dialog (no inline onclick: the security policy forbids it) */
document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-print]'); if (b) { e.preventDefault(); window.print(); } });
