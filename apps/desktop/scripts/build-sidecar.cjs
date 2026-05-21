// Drive the PaddleOCR sidecar's PyInstaller onedir build from a known
// directory anchor. The previous "../../packages/ocr-sidecar/.venv/..."
// inline pnpm script broke on Windows cmd.exe (cmd parses leading `..`
// as the command name). Resolving paths from __dirname sidesteps shell
// quirks entirely.

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const pkgDir = path.resolve(__dirname, "..", "..", "..", "packages", "ocr-sidecar");
const python = path.join(pkgDir, ".venv", "Scripts", "python.exe");
const buildScript = path.join(pkgDir, "build.py");

if (!fs.existsSync(python)) {
  console.error(`Sidecar venv python not found at:\n  ${python}`);
  console.error(
    "Create the venv with:\n" +
      "  cd packages/ocr-sidecar\n" +
      "  python -m venv .venv\n" +
      "  .venv\\Scripts\\python.exe -m pip install -r requirements.txt",
  );
  process.exit(1);
}
if (!fs.existsSync(buildScript)) {
  console.error(`Sidecar build script not found: ${buildScript}`);
  process.exit(1);
}

const r = spawnSync(python, [buildScript], { stdio: "inherit", cwd: pkgDir });
process.exit(r.status ?? 1);
