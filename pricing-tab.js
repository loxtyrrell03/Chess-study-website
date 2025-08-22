/**
 * pricing-tab.js
 * Mount-only renderer for the Pricing tab. No tab/button injection.
 * It listens for the custom `pricing:show` event dispatched from index.html.
 */
(function(){
  function ready(fn){ if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }

  function renderPricing(mount){
    if(!mount) return;
    // Build two clean cards, no page title
    mount.innerHTML = [
      '<div class="pricing-grid">',
      '  <div class="pricing-card">',
      '    <h3>Free</h3>',
      '    <div class="price">$0<span class="text-sm muted">/mo</span></div>',
      '    <ul class="space-y-2 text-sm muted">',
      '      <li>Manual session planning</li>',
      '      <li>Up to 3 saved outlines</li>',
      '      <li>Links & descriptions in sections</li>',
      '      <li>Local save</li>',
      '    </ul>',
      '  </div>',
      '  <div class="pricing-card pricing-pro">',
      '    <h3>Pro</h3>',
      '    <div class="price">$4.99<span class="text-sm muted">/month</span></div>',
      '    <ul class="space-y-2 text-sm muted">',
      '      <li><strong>AI‑generated outlines</strong> — describe what you want to do, get a ready session</li>',
      '      <li><strong>Unlimited saved outlines</strong></li>',
      '      <li><strong>File upload</strong> for quick reference</li>',
      '    </ul>',
      '    <div class="pricing-cta">',
      '      <button class="px-4 py-2 rounded-xl bg-sky-600 text-white" disabled>Upgrade — coming soon</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // Public mount helper (index.html may call this directly)
  window.mountPricing = function(mountEl){
    renderPricing(mountEl || document.getElementById('pricingMount'));
  };

  // Mount when the tab is shown
  ready(function(){
    document.addEventListener('pricing:show', function(ev){
      renderPricing(ev.detail && ev.detail.mount || document.getElementById('pricingMount'));
    });
  });
})();
