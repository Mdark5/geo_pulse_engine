const promptEl = document.getElementById('prompt');
const generateBtn = document.getElementById('generate');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');

async function generate() {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    setStatus('Describe an idea first.', true);
    return;
  }

  generateBtn.disabled = true;
  setStatus('Generating...');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Generation failed.');
    }

    previewEl.srcdoc = data.html;
    setStatus('Done.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    generateBtn.disabled = false;
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

generateBtn.addEventListener('click', generate);
