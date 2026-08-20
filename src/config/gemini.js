const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate content using Google Gemini AI
 * @param {string} prompt - The prompt to send to Gemini
 * @returns {Promise<string>} - The generated text response
 */
async function generateWithGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

/**
 * Fill placeholders in a prompt template with report data
 * Replaces {{key}} patterns with corresponding values from the data object
 * @param {string} template - The prompt template with {{placeholder}} syntax
 * @param {object} data - The report data object
 * @returns {string} - The filled prompt string
 */
function fillPromptTemplate(template, data) {
  if (!template || !data) return template || '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = data[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

module.exports = { generateWithGemini, fillPromptTemplate };
