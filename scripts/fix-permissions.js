const { execSync } = require("child_process");

if (process.platform === "win32") {
  process.exit(0);
}

try {
  execSync("chmod -R u+rwX,go+rX .", { stdio: "inherit" });
  execSync("chmod -R a+rx node_modules/@prisma/engines 2>/dev/null || true", {
    stdio: "inherit",
    shell: "/bin/bash",
  });
  console.log("Fixed directory permissions for Hostinger/Linux build.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("Could not chmod project files:", message);
}
