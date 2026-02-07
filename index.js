import express from "express";
import axios from "axios";
import AdmZip from "adm-zip";
import cors from "cors";

const app = express();
const PORT = 3000;

// ================= CONFIG =================

// Hard safety cap for RAG ingestion
const MAX_FILES = 2000;

// Ignore noisy / non-code folders
const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".changeset",
  ".claude-plugin"
];

// Keep only high-signal files for code understanding
const ALLOWED_EXTENSIONS = /\.(js|ts|tsx|py|java|go|md)$/;

// ==========================================

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/**
 * POST /ingest
 * Body:
 * {
 *   "repo_url": "https://github.com/owner/repo",
 *   "branch": "optional-branch-name"
 * }
 */
app.post("/ingest", async (req, res) => {
  try {
    console.log("BODY:", req.body);

    const { repo_url, branch } = req.body;

    if (!repo_url) {
      return res.status(400).json({ error: "repo_url is required" });
    }

    // Parse owner/repo safely
    const match = repo_url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return res.status(400).json({ error: "Invalid GitHub repository URL" });
    }

    const owner = match[1];
    const repo = match[2].replace(".git", "");

    let zipBuffer;

try {
  const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
  console.log(`Using branch: ${branch}`);

  const response = await axios.get(zipUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "github-zip-ingestion-tool",
      "Accept": "application/vnd.github+json"
    }
  });

  zipBuffer = response.data;
} catch {
  return res.status(404).json({
    error: "Could not download repository ZIP",
    message: `Branch '${branch}' not found or inaccessible`
  });
}

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    const documents = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const filePath = entry.entryName;

      // Folder-level ignores
      if (IGNORE_PATTERNS.some(p => filePath.includes(p))) {
        continue;
      }

      // Extension allowlist
      if (!ALLOWED_EXTENSIONS.test(filePath)) {
        continue;
      }

      const content = entry.getData().toString("utf8");

      documents.push({
        id: filePath,
        content,
        metadata: {
          path: filePath,
          repo: `${owner}/${repo}`,
          branch: branch
        }
      });

      // Hard safety cap
      if (documents.length >= MAX_FILES) break;
    }

    res.json({
      repo: `${owner}/${repo}`,
      branch: branch,
      file_count: documents.length,
      documents
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
});

// Health check
app.get("/", (_req, res) => {
  res.send("GitHub ZIP ingestion tool is running");
});

app.listen(PORT, () => {
  console.log(`GitHub ZIP tool running on port ${PORT}`);
});