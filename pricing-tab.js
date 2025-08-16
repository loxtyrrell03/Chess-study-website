
/**
 * pricing-tab.js
 * Drop-in script that adds a "Pricing" tab and section
 * Works with the existing .tab-link tab system in index.html without modifying it.
 *
 * Usage: Include this file after your main script in index.html:
 *   <script src="./pricing-tab.js"></script>
 */
(function(){
  function ready(fn){ if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }

  ready(function initPricingTab(){
    try{
      const tabsBar = document.querySelector('nav .tabs-bar');
      if(!tabsBar) return;

      // Prevent duplicates if loaded twice
      if (document.querySelector('.tab-link[data-tab="pricingTab"]')) return;

      // Create the "Pricing" tab button
      const pricingBtn = document.createElement('button');
      pricingBtn.className = 'tab-link';
      pricingBtn.dataset.tab = 'pricingTab';
      pricingBtn.textContent = 'Pricing';

      // Insert a separator to match existing UI
      const sep = document.createElement('div');
      sep.className = 'tab-sep';

      // Insert before "How to use" if present, else append at the end
      const helpBtn = tabsBar.querySelector('.tab-link[data-tab="helpTab"]');
      if (helpBtn) {
        tabsBar.insertBefore(sep, helpBtn);
        tabsBar.insertBefore(pricingBtn, helpBtn);
      } else {
        tabsBar.appendChild(sep);
        tabsBar.appendChild(pricingBtn);
      }

      // Build the pricing section if not present
      if (!document.getElementById('pricingTab')) {
        const pricingSec = document.createElement('section');
        pricingSec.id = 'pricingTab';
        pricingSec.className = 'hidden';
        pricingSec.innerHTML = [
          '<div class="grid lg:grid-cols-2 gap-6">',
          '  <div class="card p-6">',
          '    <h3 class="text-2xl font-extrabold mb-2">Free</h3>',
          '    <ul class="list-disc pl-5 space-y-2 text-sm">',
          '      <li>Manual session planning</li>',
          '      <li><strong>Up to 3 saved plans</strong></li>',
          '      <li>Basic link widgets & notes</li>',
          '      <li>Local & cloud sync</li>',
          '    </ul>',
          '  </div>',
          '  <div class="card p-6 border-[3px]" style="border-color: var(--accent)">',
          '    <h3 class="text-2xl font-extrabold mb-1">Pro (coming soon)</h3>',
          '    <p class="text-xs muted -mt-1 mb-2">Compare with Free</p>',
          '    <ul class="list-disc pl-5 space-y-2 text-sm">',
          '      <li><strong>ai scheduling</strong> — just write in what your schedule is and ai automatically creates the session plan for you</li>',
          '      <li><strong>unlimited saved plans</strong> (free tier will only have 3)</li>',
          '      <li><strong>google calendar integration</strong> (hypothetical in the future)</li>',
          '    </ul>',
          '    <div class="mt-4">',
          '      <button class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white" disabled>Upgrade (soon)</button>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');

        // Place the pricing section just before the Help section if possible, else append to main container
        const helpSec = document.getElementById('helpTab');
        if (helpSec && helpSec.parentElement) {
          helpSec.parentElement.insertBefore(pricingSec, helpSec);
        } else {
          // Fallback: append near main container wrapper
          const container = document.querySelector('.max-w-7xl') || document.body;
          container.appendChild(pricingSec);
        }
      }

      // Wire up tab behavior for Pricing and ensure other tabs hide Pricing when clicked
      const pricingSection = document.getElementById('pricingTab');
      const allTabButtons = Array.from(document.querySelectorAll('.tab-link'));

      function hideKnownTabs(){
        const ids = ['homeTab', 'savedTab', 'helpTab', 'pricingTab'];
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.classList.add('hidden');
        });
      }

      // Click handler for Pricing
      pricingBtn.addEventListener('click', function(){
        // Deactivate others
        allTabButtons.forEach(b => b.classList.remove('active'));
        pricingBtn.classList.add('active');
        // Hide others & show pricing
        hideKnownTabs();
        if (pricingSection) pricingSection.classList.remove('hidden');
      });

      // Ensure pricing hides when any other tab is clicked (original code doesn't know about it)
      allTabButtons.forEach(btn => {
        if (btn === pricingBtn) return;
        btn.addEventListener('click', function(){
          if (pricingSection) pricingSection.classList.add('hidden');
        });
      });

    } catch(e){
      console.error('Pricing tab init error:', e);
    }
  });
})();
