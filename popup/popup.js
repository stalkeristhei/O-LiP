document.addEventListener('DOMContentLoaded', () => {
  const keyInput = document.getElementById('api-key-input');
  const toggleVis = document.getElementById('toggle-visibility');
  const autoScan = document.getElementById('auto-scan');
  const saveBtn = document.getElementById('save-btn');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const sevPills = document.querySelectorAll('.sev-pill');
  const providerTabs = document.querySelectorAll('.provider-tab');
  const infoBox = document.getElementById('info-box');
  const keyLabel = document.getElementById('key-label');
  const consoleLink = document.getElementById('console-link');

  let selectedSev = 'high', selectedProvider = 'groq';

  const providers = {
    groq: {
      label: 'Groq API Key', placeholder: 'gsk_...', prefix: 'gsk_',
      boxClass: 'groq',
      steps: `<div class="step">1. Go to <a href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a></div>
              <div class="step">2. Sign up free → click <strong>"Create API Key"</strong></div>
              <div class="step">3. Copy the key (starts with <strong>gsk_</strong>) and paste above</div>
              <div class="step success">✓ Completely free — no credit card needed</div>`,
      consoleUrl: 'https://console.groq.com/keys', consoleTxt: 'Get Free Groq Key →'
    },
    gemini: {
      label: 'Google Gemini API Key', placeholder: 'AIza...', prefix: 'AIza',
      boxClass: 'gemini',
      steps: `<div class="step">1. Go to <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a></div>
              <div class="step">2. Click <strong>"Create API Key"</strong></div>
              <div class="step">3. Copy the key (starts with <strong>AIza</strong>) and paste above</div>
              <div class="step" style="color:rgba(255,255,255,0.4)">Note: Free tier not available in all regions</div>`,
      consoleUrl: 'https://aistudio.google.com/apikey', consoleTxt: 'Google AI Studio →'
    },
    anthropic: {
      label: 'Anthropic API Key', placeholder: 'sk-ant-api03-…', prefix: 'sk-ant-',
      boxClass: 'anthropic',
      steps: `<div class="step">1. Go to <a href="https://console.anthropic.com/keys" target="_blank">console.anthropic.com/keys</a></div>
              <div class="step">2. Add billing → Create API Key</div>
              <div class="step">3. Copy the key (starts with <strong>sk-ant-</strong>) and paste above</div>
              <div class="step" style="color:rgba(255,255,255,0.4)">~$0.003 per scan • $5 = ~1,600 scans</div>`,
      consoleUrl: 'https://console.anthropic.com/keys', consoleTxt: 'Anthropic Console →'
    }
  };

  function switchProvider(p) {
    selectedProvider = p;
    const cfg = providers[p];
    keyLabel.textContent = cfg.label;
    keyInput.placeholder = cfg.placeholder;
    keyInput.value = '';
    infoBox.className = `info-box ${cfg.boxClass}`;
    infoBox.innerHTML = cfg.steps;
    consoleLink.href = cfg.consoleUrl;
    consoleLink.textContent = cfg.consoleTxt;
    providerTabs.forEach(t => { t.className = 'provider-tab'; if (t.dataset.provider === p) t.classList.add(`active-${p}`); });
  }

  providerTabs.forEach(tab => tab.addEventListener('click', () => switchProvider(tab.dataset.provider)));

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, settings => {
    const provider = settings?.apiProvider || 'groq';
    switchProvider(provider);
    // Pre-filled demo key
    const defaultKey = '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';
    keyInput.value = settings?.apiKey || defaultKey;
    if (typeof settings?.autoScan === 'boolean') autoScan.checked = settings.autoScan;
    if (settings?.severity) { selectedSev = settings.severity; updateSevPills(); }
  });

  toggleVis.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    toggleVis.textContent = keyInput.type === 'password' ? '👁' : '🙈';
  });

  sevPills.forEach(p => p.addEventListener('click', () => { selectedSev = p.dataset.sev; updateSevPills(); }));

  function updateSevPills() {
    sevPills.forEach(p => { p.className = 'sev-pill'; if (p.dataset.sev === selectedSev) p.classList.add(`active-${selectedSev}`); });
  }
  updateSevPills();

  saveBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) { showStatus('error', 'Please enter your API key.'); return; }
    if (!key.startsWith(providers[selectedProvider].prefix)) {
      showStatus('error', `Key should start with "${providers[selectedProvider].prefix}"`); return;
    }
    saveBtn.textContent = 'Saving…'; saveBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { apiKey: key, apiProvider: selectedProvider, autoScan: autoScan.checked, severity: selectedSev } }, response => {
      saveBtn.textContent = 'Save Settings'; saveBtn.disabled = false;
      if (response?.success) showStatus('success', `Saved! Using ${selectedProvider === 'groq' ? 'Groq (free)' : selectedProvider === 'gemini' ? 'Gemini' : 'Claude Sonnet'}.`);
      else showStatus('error', 'Failed to save. Try again.');
    });
  });

  function showStatus(type, msg) {
    statusBar.className = `status-bar show ${type}`;
    statusText.textContent = msg;
    setTimeout(() => statusBar.className = 'status-bar', 4000);
  }
});
