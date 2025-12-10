import fs from 'fs'
import chalk from 'chalk'

/**
 * Cross-platform directory linking
 * Uses symlinks on Unix, junctions on Windows
 */

export type LinkType = 'symlink' | 'junction'

export interface LinkResult {
	success: boolean
	type: LinkType
	message?: string
}

/**
 * Create a directory link that works cross-platform
 *
 * On Unix/macOS/Linux: Creates a symbolic link
 * On Windows: Creates a directory junction (works without admin privileges)
 *
 * @param target - The directory to link to (must exist)
 * @param linkPath - The path where the link should be created
 * @returns Result indicating success and link type used
 */
export async function createDirectoryLink(target: string, linkPath: string): Promise<LinkResult> {
	const isWin = process.platform === 'win32'

	try {
		if (isWin) {
			// Windows: Use junction (works without admin)
			// Junction is a type of reparse point that works for directories only
			// and doesn't require elevated privileges
			fs.symlinkSync(target, linkPath, 'junction')
			return { success: true, type: 'junction' }
		} else {
			// Unix: Use regular directory symlink
			fs.symlinkSync(target, linkPath, 'dir')
			return { success: true, type: 'symlink' }
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)

		// Provide helpful error messages
		if (isWin && errorMessage.includes('EPERM')) {
			return {
				success: false,
				type: 'junction',
				message: 'Permission denied. Try running as administrator or check if the target directory exists.',
			}
		}

		return {
			success: false,
			type: isWin ? 'junction' : 'symlink',
			message: errorMessage,
		}
	}
}

/**
 * Get a user-friendly description of what type of link is used on this platform
 */
export function getLinkTypeDescription(): string {
	if (process.platform === 'win32') {
		return 'directory junctions (no admin required)'
	}
	return 'symbolic links'
}

/**
 * Show platform-specific information about directory linking
 */
export function showLinkInfo(): void {
	if (process.platform === 'win32') {
		console.log(chalk.gray('ℹ️  Using Windows directory junctions (no admin required)'))
		console.log(chalk.gray('   For full Unix compatibility, consider using WSL: https://aka.ms/wsl'))
	}
}
