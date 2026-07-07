const express = require('express');
const path = require('path');
const { generateLandingPage } = require('./generator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/generate', async (req, res) => {
  const prompt = (req.body && req.body.prompt || '').trim();

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }
  if (prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt is too long (max 2000 characters).' });
  }

  try {
    const html = await generateLandingPage(prompt);
    res.json({ html });
  } catch (err) {
    console.error('Generation failed:', err);
    res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`Instant Landing Page running at http://localhost:${PORT}`);
});
