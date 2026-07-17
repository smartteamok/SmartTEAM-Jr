/* SmartTEAM — animated favicon cycler
   Cycles the browser tab favicon through the 5 SmartTEAM brand colors every 5s.
   Usage: drop this file + the favicon-*.png set into your app, then add:
     <script src="smartteam-favicon-cycle.js"></script>
   Optionally set window.SMARTTEAM_FAVICON_BASE to the folder path first if the
   PNGs live somewhere other than alongside this script. */
(function () {
  var base = window.SMARTTEAM_FAVICON_BASE || '.';
  var colors = ['violet', 'cyan', 'amber', 'green', 'coral'];
  var i = 0;

  var link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }

  function setIcon(name) {
    link.type = 'image/png';
    link.href = base + '/favicon-' + name + '-64.png?v=' + Date.now();
  }

  setIcon(colors[i]);
  setInterval(function () {
    i = (i + 1) % colors.length;
    setIcon(colors[i]);
  }, 5000);
})();
