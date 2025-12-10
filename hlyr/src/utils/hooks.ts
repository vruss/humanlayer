import fs from 'fs'
import path from 'path'

/**
 * Cross-platform git hook generation
 * Generates Node.js-based hooks that work on all platforms (Windows, macOS, Linux)
 * No bash dependencies required
 */

/**
 * Generate a pre-commit hook that prevents committing the thoughts directory
 *
 * @param version - Hook version number for update detection
 * @returns Hook script content
 */
export function generatePreCommitHook(version: string): string {
  return `#!/usr/bin/env node
// HumanLayer thoughts protection - prevent committing thoughts directory
// Version: ${version}

const { execSync } = require('child_process');

try {
  const staged = execSync('git diff --cached --name-only', {
    encoding: 'utf8',
    stdio: 'pipe'
  }).trim();

  if (staged.split(/\\r?\\n/).some(line => line.startsWith('thoughts/'))) {
    console.error('❌ Cannot commit thoughts/ to code repository');
    console.error('The thoughts directory should only exist in your separate thoughts repository.');
    execSync('git reset HEAD -- thoughts/');
    process.exit(1);
  }
} catch (error) {
  // Only exit on our check failing, not git command failures
  if (error.message && error.message.includes('Cannot commit')) {
    process.exit(1);
  }
}

// Call any existing pre-commit hook
const fs = require('fs');
const path = require('path');
const oldHook = path.join(__dirname, 'pre-commit.old');
if (fs.existsSync(oldHook)) {
  try {
    require('child_process').execFileSync(oldHook, process.argv.slice(2), {
      stdio: 'inherit'
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}
`
}

/**
 * Generate a post-commit hook that auto-syncs thoughts after commits
 *
 * @param version - Hook version number for update detection
 * @returns Hook script content
 */
export function generatePostCommitHook(version: string): string {
  return `#!/usr/bin/env node
// HumanLayer thoughts auto-sync
// Version: ${version}

const fs = require('fs');
const { execSync } = require('child_process');

// Check if we're in a worktree
if (fs.existsSync('.git') && fs.statSync('.git').isFile()) {
  // Skip auto-sync in worktrees to avoid repository boundary confusion
  // See: https://linear.app/humanlayer/issue/ENG-1455
  process.exit(0);
}

// Get the commit message
const commitMsg = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();

// Auto-sync thoughts after each commit (only in non-worktree repos)
const { spawn } = require('child_process');
spawn('humanlayer', ['thoughts', 'sync', '--message', \`Auto-sync with commit: \${commitMsg}\`], {
  detached: true,
  stdio: 'ignore'
}).unref();

// Call any existing post-commit hook
const path = require('path');
const oldHook = path.join(__dirname, 'post-commit.old');
if (fs.existsSync(oldHook)) {
  try {
    require('child_process').execFileSync(oldHook, process.argv.slice(2), {
      stdio: 'inherit'
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}
`
}

/**
 * Check if a hook needs updating based on version number
 */
function hookNeedsVersionUpdate(hookPath: string, newContent: string): boolean {
  if (!fs.existsSync(hookPath)) return true

  const existing = fs.readFileSync(hookPath, 'utf8')
  const existingVersion = existing.match(/Version: (\d+)/)?.[1]
  const newVersion = newContent.match(/Version: (\d+)/)?.[1]

  if (!existingVersion || !newVersion) return true
  return parseInt(existingVersion) < parseInt(newVersion)
}

/**
 * Install a git hook, backing up any existing non-HumanLayer hook
 *
 * @param hooksDir - Path to .git/hooks directory
 * @param hookName - Name of the hook (e.g., 'pre-commit')
 * @param content - Hook script content
 * @returns Object indicating if hook was updated
 */
export function installGitHook(
  hooksDir: string,
  hookName: string,
  content: string,
): { updated: boolean } {
  const hookPath = path.join(hooksDir, hookName)
  const oldHookPath = `${hookPath}.old`

  // Check if hook needs updating (version check)
  const needsUpdate =
    !fs.existsSync(hookPath) ||
    !fs.readFileSync(hookPath, 'utf8').includes('HumanLayer thoughts') ||
    hookNeedsVersionUpdate(hookPath, content)

  if (!needsUpdate) {
    return { updated: false }
  }

  // Backup existing non-HumanLayer hook
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8')
    if (!existing.includes('HumanLayer thoughts')) {
      // Not our hook, back it up
      fs.renameSync(hookPath, oldHookPath)
    } else {
      // Old version of our hook, just replace it
      fs.unlinkSync(hookPath)
    }
  }

  // Write new hook
  fs.writeFileSync(hookPath, content)

  // Make executable on Unix (Windows doesn't need this)
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(hookPath, '755')
    } catch {
      // Ignore chmod errors
    }
  }

  return { updated: true }
}
