import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { generatePreCommitHook, generatePostCommitHook, installGitHook } from './hooks'

// Mock fs module
vi.mock('fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}))

describe('hooks utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generatePreCommitHook', () => {
    it('should generate a valid Node.js script', () => {
      const version = '1'
      const hook = generatePreCommitHook(version)

      // Should have Node.js shebang
      expect(hook).toContain('#!/usr/bin/env node')

      // Should have version comment
      expect(hook).toContain(`// Version: ${version}`)

      // Should import required modules
      expect(hook).toContain("const { execSync } = require('child_process');")
      expect(hook).toContain("const fs = require('fs');")
      expect(hook).toContain("const path = require('path');")

      // Should contain HumanLayer branding
      expect(hook).toContain('HumanLayer thoughts')
    })

    it('should check for thoughts directory in staged files', () => {
      const hook = generatePreCommitHook('1')

      // Should check git diff for staged files
      expect(hook).toContain('git diff --cached --name-only')
      expect(hook).toContain('thoughts/')
    })

    it('should handle errors gracefully', () => {
      const hook = generatePreCommitHook('1')

      // Should have error handling
      expect(hook).toContain('try {')
      expect(hook).toContain('} catch (error) {')
      expect(hook).toContain('console.error')
      expect(hook).toContain('process.exit(1);')
    })

    it('should call existing pre-commit hook if present', () => {
      const hook = generatePreCommitHook('1')

      // Should check for old hook
      expect(hook).toContain('pre-commit.old')
      expect(hook).toContain('fs.existsSync(oldHook)')
      expect(hook).toContain('execFileSync')
    })

    it('should prevent committing thoughts directory', () => {
      const hook = generatePreCommitHook('1')

      // Should prevent thoughts/ from being committed
      expect(hook).toContain('Cannot commit thoughts/')
      expect(hook).toContain('git reset HEAD -- thoughts/')
    })
  })

  describe('generatePostCommitHook', () => {
    it('should generate a valid Node.js script', () => {
      const version = '1'
      const hook = generatePostCommitHook(version)

      // Should have Node.js shebang
      expect(hook).toContain('#!/usr/bin/env node')

      // Should have version comment
      expect(hook).toContain(`// Version: ${version}`)

      // Should import required modules
      expect(hook).toContain("const { execSync } = require('child_process');")
      expect(hook).toContain("const fs = require('fs');")
    })

    it('should use spawn for async execution', () => {
      const hook = generatePostCommitHook('1')

      // Should use spawn for non-blocking execution
      expect(hook).toContain("spawn('humanlayer'")
      expect(hook).toContain('thoughts')
      expect(hook).toContain('sync')
      expect(hook).toContain('.unref()')
    })

    it('should skip auto-sync in worktrees', () => {
      const hook = generatePostCommitHook('1')

      // Should detect worktrees
      expect(hook).toContain("fs.existsSync('.git')")
      expect(hook).toContain("statSync('.git').isFile()")
      expect(hook).toContain('Skip auto-sync in worktrees')
    })

    it('should call existing post-commit hook if present', () => {
      const hook = generatePostCommitHook('1')

      // Should check for old hook
      expect(hook).toContain('post-commit.old')
      expect(hook).toContain('fs.existsSync(oldHook)')
    })

    it('should include commit message in sync', () => {
      const hook = generatePostCommitHook('1')

      // Should get commit message
      expect(hook).toContain('git log -1 --pretty=%B')
      expect(hook).toContain('Auto-sync with commit')
    })
  })

  describe('installGitHook', () => {
    const hooksDir = '/path/to/repo/.git/hooks'
    const hookName = 'pre-commit'
    const hookContent = generatePreCommitHook('1')

    beforeEach(() => {
      // Default mock setup - hook doesn't exist
      vi.mocked(fs.default.existsSync).mockReturnValue(false)
    })

    it('should write hook file when hook does not exist', () => {
      const result = installGitHook(hooksDir, hookName, hookContent)

      const expectedPath = path.join(hooksDir, hookName)
      expect(fs.default.writeFileSync).toHaveBeenCalledWith(expectedPath, hookContent)
      expect(result.updated).toBe(true)
    })

    it('should backup existing non-HumanLayer hook', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(true)
      vi.mocked(fs.default.readFileSync).mockReturnValue("#!/bin/bash\necho 'some other hook'")

      installGitHook(hooksDir, hookName, hookContent)

      const expectedPath = path.join(hooksDir, hookName)
      expect(fs.default.renameSync).toHaveBeenCalledWith(expectedPath, `${expectedPath}.old`)
    })

    it('should replace existing HumanLayer hook with older version', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(true)
      vi.mocked(fs.default.readFileSync).mockReturnValue(
        '#!/usr/bin/env node\n// HumanLayer thoughts\n// Version: 0',
      )

      const newHook = generatePreCommitHook('1')
      installGitHook(hooksDir, hookName, newHook)

      const expectedPath = path.join(hooksDir, hookName)
      expect(fs.default.unlinkSync).toHaveBeenCalledWith(expectedPath)
      expect(fs.default.writeFileSync).toHaveBeenCalledWith(expectedPath, newHook)
    })

    it('should not update if hook is already up to date', () => {
      vi.mocked(fs.default.existsSync).mockReturnValue(true)
      vi.mocked(fs.default.readFileSync).mockReturnValue(hookContent)

      const result = installGitHook(hooksDir, hookName, hookContent)

      expect(fs.default.writeFileSync).not.toHaveBeenCalled()
      expect(result.updated).toBe(false)
    })

    it('should make hook executable on Unix', () => {
      // Mock platform as Unix
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      })

      installGitHook(hooksDir, hookName, hookContent)

      const expectedPath = path.join(hooksDir, hookName)
      expect(fs.default.chmodSync).toHaveBeenCalledWith(expectedPath, '755')

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      })
    })

    it('should skip chmod on Windows', () => {
      // Mock platform as Windows
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      })

      installGitHook(hooksDir, hookName, hookContent)

      expect(fs.default.chmodSync).not.toHaveBeenCalled()

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      })
    })

    it('should handle post-commit hook', () => {
      const postCommitContent = generatePostCommitHook('1')

      const result = installGitHook(hooksDir, 'post-commit', postCommitContent)

      const expectedPath = path.join(hooksDir, 'post-commit')
      expect(fs.default.writeFileSync).toHaveBeenCalledWith(expectedPath, postCommitContent)
      expect(result.updated).toBe(true)
    })
  })

  describe('hook integration', () => {
    it('should generate different content for pre-commit and post-commit', () => {
      const preCommit = generatePreCommitHook('1')
      const postCommit = generatePostCommitHook('1')

      // Different purposes
      expect(preCommit).toContain('thoughts protection')
      expect(postCommit).toContain('thoughts auto-sync')

      // Different behaviors
      expect(preCommit).toContain('Cannot commit thoughts/')
      expect(postCommit).toContain("spawn('humanlayer'")
    })

    it('should include version in both hooks', () => {
      const version = '42'
      const preCommit = generatePreCommitHook(version)
      const postCommit = generatePostCommitHook(version)

      expect(preCommit).toContain(`// Version: ${version}`)
      expect(postCommit).toContain(`// Version: ${version}`)
    })
  })
})
