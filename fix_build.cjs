const fs = require('fs');

let mainJs = fs.readFileSync('src/main.js', 'utf8');
mainJs = mainJs.replace(
  /highlightGraphByCode\(\\\\'\s*\+\s*empCode\s*\+\s*\\\\'\)/g,
  "highlightGraphByCode('${empCode}')"
);
mainJs = mainJs.replace(
  /return '<a href="#" class="citation-badge".*/g,
  "return `<a href=\"#\" class=\"citation-badge\" data-emp=\"${empCode}\" onclick=\"event.preventDefault(); highlightGraphByCode('${empCode}')\">${match}</a>`;"
);
fs.writeFileSync('src/main.js', mainJs);

let debugHtml = fs.readFileSync('debug_neural_network_diagram.html', 'utf8');
debugHtml = debugHtml.replace('<script src="./debug-history.js"></script>', '<script type="module" src="./debug-history.js"></script>');
fs.writeFileSync('debug_neural_network_diagram.html', debugHtml);
