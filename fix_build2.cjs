const fs = require('fs');
let debugHtml = fs.readFileSync('debug_neural_network_diagram.html', 'utf8');
debugHtml = debugHtml.replace('<script type="module" src="./debug-history.js"></script>', '<script src="/debug-history.js"></script>');
fs.writeFileSync('debug_neural_network_diagram.html', debugHtml);
