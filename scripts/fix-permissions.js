const { execSync } = require("child_process");

if (process.platform === "win32") {
  process.exit(0);
}

try {
  execSync("chmod -R u+rwX,go+rX .", { stdio: "inherit" });
  console.log("Fixed directory permissions for Hostinger/Linux build.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("Could not chmod project files:", message);
}
