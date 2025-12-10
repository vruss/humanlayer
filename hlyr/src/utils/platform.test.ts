import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isWindows, removeReadOnly, makeFileExecutable } from './platform.js'
import fs from 'fs'
import { execSync } from 'child_process'

// Mock fs and child_process
vi.mock('fs')
vi.mock('child_process')

describe('Platform Utilities', () => {
	describe('isWindows()', () => {
		const originalPlatform = process.platform

		afterEach(() => {
			// Restore original platform
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
			})
		})

		it('should return true on Windows', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
			})
			expect(isWindows()).toBe(true)
		})

		it('should return false on macOS', () => {
			Object.defineProperty(process, 'platform', {
				value: 'darwin',
			})
			expect(isWindows()).toBe(false)
		})

		it('should return false on Linux', () => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
			})
			expect(isWindows()).toBe(false)
		})
	})

	describe('removeReadOnly()', () => {
		const originalPlatform = process.platform

		beforeEach(() => {
			vi.clearAllMocks()
		})

		afterEach(() => {
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
			})
		})

		it('should use chmod on Unix platforms', () => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
			})

			const dirPath = '/test/path'
			removeReadOnly(dirPath)

			expect(execSync).toHaveBeenCalledWith(`chmod -R 755 "${dirPath}"`, { stdio: 'pipe' })
		})

		it('should handle chmod errors gracefully on Unix', () => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
			})

			vi.mocked(execSync).mockImplementation(() => {
				throw new Error('Permission denied')
			})

			// Should not throw
			expect(() => removeReadOnly('/test/path')).not.toThrow()
		})

		it('should use Node.js fs operations on Windows', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
			})

			const mockFiles = [
				{ name: 'file1.txt', isDirectory: () => false },
				{ name: 'dir1', isDirectory: () => true },
			]

			vi.mocked(fs.existsSync).mockReturnValue(true)
			// Mock readdirSync to return empty for subdirectories to prevent infinite recursion
			vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
				if (dir === '/test/path') {
					return mockFiles as any
				}
				// Return empty for subdirectories
				return [] as any
			})
			vi.mocked(fs.chmodSync).mockImplementation(() => {})

			removeReadOnly('/test/path')

			// Should call chmodSync for each file
			expect(fs.chmodSync).toHaveBeenCalled()
		})

		it('should handle non-existent directories on Windows', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
			})

			vi.mocked(fs.existsSync).mockReturnValue(false)

			// Should not throw
			expect(() => removeReadOnly('/nonexistent')).not.toThrow()
		})

		it('should recurse into subdirectories on Windows', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
			})

			const mockRootFiles = [{ name: 'subdir', isDirectory: () => true }]
			const mockSubFiles = [{ name: 'file.txt', isDirectory: () => false }]

			let callCount = 0
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readdirSync).mockImplementation((path: any) => {
				callCount++
				if (callCount === 1) return mockRootFiles as any
				return mockSubFiles as any
			})
			vi.mocked(fs.chmodSync).mockImplementation(() => {})

			removeReadOnly('/test/path')

			// Should have called readdirSync twice (root + subdir)
			expect(fs.readdirSync).toHaveBeenCalledTimes(2)
		})

		it('should handle Windows chmod errors gracefully', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
			})

			const mockFiles = [{ name: 'locked.txt', isDirectory: () => false }]

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any)
			vi.mocked(fs.chmodSync).mockImplementation(() => {
				throw new Error('Access denied')
			})

			// Should not throw
			expect(() => removeReadOnly('/test/path')).not.toThrow()
		})
	})

	describe('makeFileExecutable()', () => {
		const originalPlatform = process.platform

		beforeEach(() => {
			vi.clearAllMocks()
		})

		afterEach(() => {
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
			})
		})

		it('should use chmod on Unix platforms', () => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
			})

			const filePath = '/test/script.sh'
			makeFileExecutable(filePath)

			expect(fs.chmodSync).toHaveBeenCalledWith(filePath, '755')
		})

		it('should handle chmod errors gracefully on Unix', () => {
			Object.defineProperty(process, 'platform', {
				value: 'darwin',
			})

			vi.mocked(fs.chmodSync).mockImplementation(() => {
				throw new Error('Permission denied')
			})

			// Should not throw
			expect(() => makeFileExecutable('/test/script.sh')).not.toThrow()
		})

		it('should do nothing on Windows', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
			})

			makeFileExecutable('/test/script.bat')

			// Should not call chmod on Windows
			expect(fs.chmodSync).not.toHaveBeenCalled()
			expect(execSync).not.toHaveBeenCalled()
		})
	})

	describe('Cross-platform behavior', () => {
		const originalPlatform = process.platform

		afterEach(() => {
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
			})
			vi.clearAllMocks()
		})

		it('should use different strategies per platform for removeReadOnly', () => {
			// Test Unix
			Object.defineProperty(process, 'platform', { value: 'linux' })
			removeReadOnly('/path1')
			expect(execSync).toHaveBeenCalled()

			vi.clearAllMocks()

			// Test Windows
			Object.defineProperty(process, 'platform', { value: 'win32' })
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readdirSync).mockReturnValue([])
			removeReadOnly('/path2')
			expect(execSync).not.toHaveBeenCalled()
		})

		it('should handle platform detection consistently', () => {
			const platforms = ['win32', 'darwin', 'linux', 'freebsd']

			platforms.forEach((platform) => {
				Object.defineProperty(process, 'platform', { value: platform })
				const result = isWindows()
				expect(result).toBe(platform === 'win32')
			})
		})
	})
})
