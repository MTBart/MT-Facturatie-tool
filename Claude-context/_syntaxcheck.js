const fs = require("fs");
const file = process.argv[2];
const html = fs.readFileSync(file, "utf8");
const blocks = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let errs = 0;
blocks.forEach((b, i) => {
  try { new Function(b); } catch (e) { errs++; console.log("blok", i, ":", e.message); }
});
console.log("blokken:", blocks.length, "fouten:", errs);
console.log("regels:", html.split("\n").length, "bytes:", Buffer.byteLength(html));
