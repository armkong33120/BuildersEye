const fs = require('fs');

function forceRenderUrl(file) {
  let content = fs.readFileSync(file, 'utf8');
  // Replace the env fallback logic with hardcoded render URL, while keeping ?backend= query param
  content = content.replace(
    /const (?:RAG_BACKEND|backend|backendUrl) = (?:[^;]+);/g,
    (match) => {
      if (match.includes('RAG_BACKEND')) {
        return "const RAG_BACKEND = (urlParams && urlParams.get('backend')) || 'https://builderseye-backend.onrender.com';";
      }
      if (match.includes('backendUrl')) {
        return "const backendUrl = new URLSearchParams(window.location.search).get('backend') || 'https://builderseye-backend.onrender.com';";
      }
      if (match.includes('backend')) {
        return "const backend = new URLSearchParams(window.location.search).get('backend') || 'https://builderseye-backend.onrender.com';";
      }
      return match;
    }
  );
  fs.writeFileSync(file, content);
}

forceRenderUrl('src/main.js');
forceRenderUrl('src/js/admin.js');
forceRenderUrl('src/js/showcase.js');
