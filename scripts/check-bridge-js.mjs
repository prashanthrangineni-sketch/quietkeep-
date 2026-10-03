import fs from 'fs';
import path from 'path';

const file = path.join('android', 'app', 'src', 'main', 'java', 'com', 'pranix', 'quietkeep', 'MainActivity.java');
const content = fs.readFileSync(file, 'utf8');

// Extract the JS string literal passed to view.evaluateJavascript
const startStr = 'String js = "javascript:(function() {';
const startIndex = content.indexOf(startStr);
if (startIndex === -1) {
    console.error('Could not find JS block start.');
    process.exit(1);
}
const endStr = 'view.evaluateJavascript(js, null);';
const endIndex = content.indexOf(endStr, startIndex);
if (endIndex === -1) {
    console.error('Could not find JS block end.');
    process.exit(1);
}

const jsBlock = content.substring(startIndex, endIndex);

// Reconstruct string
const lines = jsBlock.split('\n');
let jsSource = '';
for (let line of lines) {
    line = line.trim();
    if (line.startsWith('+ "') || line.startsWith('String js = "')) {
        let str = line.substring(line.indexOf('"') + 1);
        str = str.substring(0, str.lastIndexOf('"'));
        // Unescape using JSON parse
        str = str.replace(/\\"/g, '"');
        try { str = JSON.parse('"' + str.replace(/"/g, '\\"') + '"'); } catch(e){}
        jsSource += str;
    }
}

// Replace Java variables
jsSource = jsSource.replace('"' + ' + appType + ' + '"', '"dummy_app"');
jsSource = jsSource.replace('"' + ' + SERVER_URL + ' + '"', '"dummy_server"');
console.log(jsSource);

// Run through new Function to check syntax
try {
    new Function(jsSource);
    console.log('JS syntax is valid.');
} catch (e) {
    console.error('JS syntax error:', e.message);
    process.exit(1);
}

// Strip comments for checking required globals
const noComments = jsSource.replace(/\/\/.*$/gm, '');

const required = ['__QK_TTS__', '__QK_CONTACTS__', '__QK_WAKE__', '__QK_OCR__'];
let missing = false;
for (const req of required) {
    if (!noComments.includes(req)) {
        console.error(`Missing or commented out: ${req}`);
        missing = true;
    }
}

if (missing) {
    process.exit(1);
}

console.log('All bridge globals found outside comments.');
process.exit(0);
