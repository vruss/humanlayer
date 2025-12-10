import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDirectoryLink, getLinkTypeDescription, showLinkInfo } from './symlink'

// Mock fs module - use a factory function to avoid hoisting issues
vi.mock('fs', () => {
  const symlinkSync = vi.fn()
  return {
    default: {
      symlinkSync,
    },
  }
})

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    gray: (text: string) => text,
  },
}))

describe('symlink utilities', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let originalPlatform: string

  beforeEach(async () => {
    const fs = await import('fs')
    vi.clearAllMocks()
    // Reset mock implementations to default (no-op, no errors)
    vi.mocked(fs.default.symlinkSync).mockReset()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    originalPlatform = process.platform
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    })
  })

  describe('createDirectoryLink', () => {
    const target = '/path/to/target'
    const linkPath = '/path/to/link'

    describe('on Unix systems', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          writable: true,
        })
      })

      it("should create a symlink with 'dir' type", async () => {
        const fs = await import('fs')
        const result = await createDirectoryLink(target, linkPath)

        expect(fs.default.symlinkSync).toHaveBeenCalledWith(target, linkPath, 'dir')
        expect(result.success).toBe(true)
        expect(result.type).toBe('symlink')
      })

      it('should return error result when symlinkSync fails', async () => {
        const fs = await import('fs')
        const error = new Error('Permission denied')
        vi.mocked(fs.default.symlinkSync).mockImplementation(() => {
          throw error
        })

        const result = await createDirectoryLink(target, linkPath)

        expect(result.success).toBe(false)
        expect(result.type).toBe('symlink')
        expect(result.message).toBe('Permission denied')
      })

      it('should work on macOS', async () => {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          writable: true,
        })

        const fs = await import('fs')
        // Reset mock to default behavior (no error)
        vi.mocked(fs.default.symlinkSync).mockReset()

        const result = await createDirectoryLink(target, linkPath)

        expect(fs.default.symlinkSync).toHaveBeenCalledWith(target, linkPath, 'dir')
        expect(result.success).toBe(true)
        expect(result.type).toBe('symlink')
      })
    })

    describe('on Windows systems', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
        })
      })

      it("should create a junction with 'junction' type", async () => {
        const fs = await import('fs')
        const result = await createDirectoryLink(target, linkPath)

        expect(fs.default.symlinkSync).toHaveBeenCalledWith(target, linkPath, 'junction')
        expect(result.success).toBe(true)
        expect(result.type).toBe('junction')
      })

      it('should provide helpful message on EPERM errors', async () => {
        const fs = await import('fs')
        const error = new Error('EPERM: operation not permitted, symlink')
        vi.mocked(fs.default.symlinkSync).mockImplementation(() => {
          throw error
        })

        const result = await createDirectoryLink(target, linkPath)

        expect(result.success).toBe(false)
        expect(result.type).toBe('junction')
        expect(result.message).toContain('Permission denied')
        expect(result.message).toContain('administrator')
      })

      it('should return error result for other errors', async () => {
        const fs = await import('fs')
        const error = new Error('Target does not exist')
        vi.mocked(fs.default.symlinkSync).mockImplementation(() => {
          throw error
        })

        const result = await createDirectoryLink(target, linkPath)

        expect(result.success).toBe(false)
        expect(result.type).toBe('junction')
        expect(result.message).toBe('Target does not exist')
      })

      it('should handle non-Error exceptions', async () => {
        const fs = await import('fs')
        vi.mocked(fs.default.symlinkSync).mockImplementation(() => {
          throw 'String error'
        })

        const result = await createDirectoryLink(target, linkPath)

        expect(result.success).toBe(false)
        expect(result.type).toBe('junction')
        expect(result.message).toBe('String error')
      })
    })
  })

  describe('getLinkTypeDescription', () => {
    it("should return 'symbolic links' for Unix systems", () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      })
      expect(getLinkTypeDescription()).toBe('symbolic links')
    })

    it("should return 'symbolic links' for macOS", () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      })
      expect(getLinkTypeDescription()).toBe('symbolic links')
    })

    it("should return 'directory junctions (no admin required)' for Windows", () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      })
      expect(getLinkTypeDescription()).toBe('directory junctions (no admin required)')
    })
  })

  describe('showLinkInfo', () => {
    it('should not show info on Unix systems', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      })

      showLinkInfo()

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should show Windows junction info with WSL recommendation', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      })

      showLinkInfo()

      expect(consoleLogSpy).toHaveBeenCalledTimes(2)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Windows directory junctions'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('no admin required'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('WSL'))
    })
  })
})
