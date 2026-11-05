const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, process.argv[2] || '_site');

if (!output.startsWith(`${root}${path.sep}`)) {
  throw new Error('The Pages preview output must be inside the project directory.');
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of ['index.html', 'perfumes.html', 'styles.css', 'script.js', 'pages-preview.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}

for (const file of ['kidscloth1.webp', 'kidscloth2.webp', 'kidscloth3.webp']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}

fs.cpSync(path.join(root, 'img'), path.join(output, 'img'), { recursive: true });

for (const file of ['index.html', 'perfumes.html']) {
  const filePath = path.join(output, file);
  const html = fs.readFileSync(filePath, 'utf8').replace(
    /(<script src="script\.js" defer><\/script>)/,
    '<script src="pages-preview.js" defer></script>\n    $1'
  );
  fs.writeFileSync(filePath, html);
}
