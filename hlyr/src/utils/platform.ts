import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Cross-platform file system utilities
 * Provides platform-specific implementations while keeping calling code clean
 */

export function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Remove read-only attributes from a directory recursively
 * On Unix: uses chmod -R 755
 * On Windows: uses Node.js fs operations to make files writable
 */
export function removeReadOnly(dirPath: string): void {
  if (!isWindows()) {
    // Unix: use chmod
    try {
      execSync(`chmod -R 755 "${dirPath}"`, { stdio: 'pipe' })
    } catch (error) {
      // Ignore chmod errors - best effort
    }
  } else {
    // Windows: use Node.js fs operations to remove read-only
    const removeReadOnlyRecursive = (dir: string) => {
      if (!fs.existsSync(dir)) return

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        try {
          // Make writable (0o666 = rw-rw-rw-)
          fs.chmodSync(fullPath, 0o666)
          if (entry.isDirectory()) {
            removeReadOnlyRecursive(fullPath)
          }
        } catch {
          // Ignore errors, file might already be writable or inaccessible
        }
      }
    }

    try {
      removeReadOnlyRecursive(dirPath)
    } catch {
      // Ignore errors - best effort
    }
  }
}

/**
 * Make a file executable
 * On Unix: uses chmod +x
 * On Windows: no-op (not needed)
 */
export function makeFileExecutable(filePath: string): void {
  if (!isWindows()) {
    try {
      fs.chmodSync(filePath, '755')
    } catch {
      // Ignore errors
    }
  }
  // Windows: no-op, executability is determined by file extension
}
