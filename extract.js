const fs = require('fs');

const content = fs.readFileSync('public/app.js', 'utf8');
const casesMatch = content.match(/const CLINICAL_CASES = (\[[\s\S]*?\]);\n\nconst BASE_BEDS/);
if (casesMatch) {
  const casesJson = casesMatch[1];
  // to evaluate the json-like string (which might have unquoted keys), we can use Function
  const cases = (new Function(`return ${casesJson}`))();
  fs.mkdirSync('data', {recursive: true});
  fs.writeFileSync('data/cases.json', JSON.stringify(cases, null, 2));
  console.log('Extracted ' + cases.length + ' cases.');
  
  // Now replace app.js content to let CLINICAL_CASES be an empty array or fetched later
  // Actually we can just leave let CLINICAL_CASES = [];
  const newContent = content.replace(casesMatch[0], 'let CLINICAL_CASES = [];\n\nconst BASE_BEDS');
  fs.writeFileSync('public/app.js', newContent);
} else {
  console.log('No match found');
}
