/**
 * pricing-tab.js
 * Mount-only renderer for the Pricing tab. No tab/button injection.
 * It listens for the custom `pricing:show` event dispatched from index.html.
 */
(function(){
  function ready(fn){ if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }

  function renderPricing(mount){
    if(!mount) return;
    // Two clean cards side-by-side
    mount.innerHTML = [
      '<div class="pricing-grid">',
      '  <div class="pricing-card card aurora-frame p-4">',
      '    <div class="pricing-head">',
      '      <div class="pricing-title">Free</div>',
      '      <div class="pricing-pill">Good start</div>',
      '    </div>',
      '    <div class="price">$0<span class="text-sm muted">/mo</span></div>',
      '    <ul class="pricing-list">',
      '      <li>Manual session planning</li>',
      '      <li>Up to 3 saved outlines</li>',
      '      <li>Links & descriptions in sections</li>',
      '      <li>Local save</li>',
      '    </ul>',
      '  </div>',
      '  <div class="pricing-card pricing-pro card aurora-frame p-4">',
      '    <div class="pricing-head">',
      '      <div class="pricing-title">Pro</div>',
      '      <div class="pricing-pill accent">Best value</div>',
      '    </div>',
      '    <div class="price">$4.99<span class="text-sm muted">/month</span></div>',
      '    <ul class="pricing-list">',
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
