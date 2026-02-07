const axios = require("axios");
const AdmZip = require("adm-zip");

const MAX_FILES = 80;

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

const ALLOWED_EXTENSIONS = /\.(js|ts|tsx|py|java|go)$/;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { repo_url, branch = "main" } = req.body;

    if (!repo_url) {
      return res.status(400).json({ error: "repo_url is required" });
    }

    const match = repo_url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return res.status(400).json({ error: "Invalid GitHub repository URL" });
    }

    const owner = match[1];
    const repo = match[2].replace(".git", "");

    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;

    const response = await axios.get(zipUrl, {
      responseType: "arraybuffer",
      timeout: 30000
    });

    const zip = new AdmZip(response.data);
    const entries = zip.getEntries();

    const documents = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const filePath = entry.entryName;

      if (IGNORE_PATTERNS.some(p => filePath.includes(p))) continue;
      if (!ALLOWED_EXTENSIONS.test(filePath)) continue;

      documents.push({
        id: filePath,
        content: entry.getData().toString("utf8"),
        metadata: {
          path: filePath,
          repo: `${owner}/${repo}`,
          branch
        }
      });

      if (documents.length >= MAX_FILES) break;
    }

    res.status(200).json({
      repo: `${owner}/${repo}`,
      branch,
      file_count: documents.length,
      documents
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
