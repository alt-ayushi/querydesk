import path from 'path';
import fs from 'fs';
import os from 'os';

// Derive the workspace root dynamically
const getWorkspaceRoot = () => {
  if (process.env.OPENCLAW_WORKSPACE) {
    return process.env.OPENCLAW_WORKSPACE;
  }
  return path.join(os.homedir(), '.openclaw', 'workspace');
};

export const getMedia = (req, res) => {
  const { path: requestedPath } = req.query;

  if (!requestedPath) {
    return res.status(400).json({ error: 'Media path is required' });
  }

  const workspaceRoot = getWorkspaceRoot();
  
  // Resolve the requested path to an absolute path
  const absoluteRequestedPath = path.resolve(requestedPath);

  // Validate that the requested path actually resides inside the workspace root
  // This prevents directory traversal attacks (e.g. ?path=../../../Windows/System32/secret.txt)
  if (!absoluteRequestedPath.startsWith(workspaceRoot)) {
    console.warn(`[Media API] Blocked access to path outside workspace: ${absoluteRequestedPath}`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Ensure the file exists
  if (!fs.existsSync(absoluteRequestedPath)) {
    return res.status(404).json({ error: 'Media not found' });
  }

  // Serve the file
  res.sendFile(absoluteRequestedPath, (err) => {
    if (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error serving media file' });
      }
    }
  });
};
