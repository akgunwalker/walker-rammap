const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

test("package and desktop entry are valid",()=>{
  const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
  assert.equal(pkg.main,"desktop.js");
  assert.equal(pkg.version,"2.1.0");
  assert.equal(pkg.author,"akgunwalker");
  assert.ok(pkg.build.files.includes("advanced-server.js"));
});
test("server JavaScript parses",()=>{
  for(const file of["server.js","advanced-server.js","desktop.js","public/app.js"])
    assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(file,"utf8"),{filename:file}));
});
test("network protection remains present",()=>{
  const source=fs.readFileSync("server.js","utf8").toLowerCase();
  for(const name of["goodbyedpi","splitware","wireguard","dnscrypt-proxy"])assert.ok(source.includes(name));
});
test("v2 security, health and widget features remain present",()=>{
  const advanced=fs.readFileSync("advanced-server.js","utf8");
  const desktop=fs.readFileSync("desktop.js","utf8");
  for(const feature of["/api/security","/api/health","applyRetention","foregroundFullscreen","triggerApps","X-Walker-Session"])assert.ok(advanced.includes(feature));
  assert.ok(desktop.includes("createWidget"));
  assert.ok(fs.existsSync("public/widget.html"));
});
