import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import chalk from 'chalk'
import readline from 'readline'
import {
	ThoughtsConfig,
	loadThoughtsConfig,
	saveThoughtsConfig,
	getDefaultThoughtsRepo,
	ensureThoughtsRepoExists,
	createThoughtsDirectoryStructure,
	getCurrentRepoPath,
	getRepoNameFromPath,
	expandPath,
	getRepoThoughtsPath,
	getGlobalThoughtsPath,
	updateSymlinksForNewUsers,
	validateProfile,
	resolveProfileForRepo,
} from '../../thoughtsConfig.js'
import { isWindows, removeReadOnly } from '../../utils/platform.js'
import { createDirectoryLink, showLinkInfo } from '../../utils/symlink.js'
import { generatePreCommitHook, generatePostCommitHook, installGitHook } from '../../utils/hooks.js'

interface InitOptions {
	force?: boolean
	configFile?: string
	directory?: string
	profile?: string
	linkClaudeCode?: boolean
}

function sanitizeDirectoryName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function findHumanLayerRepo(): string | null {
	try {
		// Try to find the HumanLayer repo from the hlyr package location
		// The hlyr package is at: humanlayer/hlyr/
		// We need to find: humanlayer/
		const hlyrPath = path.dirname(path.dirname(import.meta.url.replace('file://', '')))
		const humanlayerPath = path.dirname(hlyrPath)

		// Check if hack/link_to_repo.sh exists in the parent directory
		const linkScript = path.join(humanlayerPath, 'hack', 'link_to_repo.sh')
		if (fs.existsSync(linkScript)) {
			return humanlayerPath
		}

		// Fallback: try common installation paths
		const possiblePaths = [
			path.join(os.homedir(), '.humanlayer'),
			path.join(os.homedir(), 'src', 'public', 'humanlayer'),
			'/opt/humanlayer',
		]

		for (const possiblePath of possiblePaths) {
			const linkScript = path.join(possiblePath, 'hack', 'link_to_repo.sh')
			if (fs.existsSync(linkScript)) {
				return possiblePath
			}
		}

		return null
	} catch {
		return null
	}
}

function updateGitIgnore(repoPath: string, entries: string[]): { added: string[]; skipped: string[] } {
	const gitignorePath = path.join(repoPath, '.gitignore')
	const added: string[] = []
	const skipped: string[] = []

	// Read existing .gitignore or create empty
	let content = ''
	if (fs.existsSync(gitignorePath)) {
		content = fs.readFileSync(gitignorePath, 'utf8')
	}

	const lines = content
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)

	// Add entries that don't already exist
	for (const entry of entries) {
		if (!lines.includes(entry)) {
			lines.push(entry)
			added.push(entry)
		} else {
			skipped.push(entry)
		}
	}

	// Write back with newline
	if (added.length > 0) {
		const newContent = lines.join('\n') + '\n'
		fs.writeFileSync(gitignorePath, newContent)
	}

	return { added, skipped }
}

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

function checkExistingSetup(config?: ThoughtsConfig | null): {
	exists: boolean
	isValid: boolean
	isOldStructure?: boolean
	message?: string
} {
	const thoughtsDir = path.join(process.cwd(), 'thoughts')

	if (!fs.existsSync(thoughtsDir)) {
		return { exists: false, isValid: false }
	}

	// Check if it's a directory
	if (!fs.lstatSync(thoughtsDir).isDirectory()) {
		return { exists: true, isValid: false, message: 'thoughts exists but is not a directory' }
	}

	// Check for old structure (local/ and global/ directories)
	const localPath = path.join(thoughtsDir, 'local')
	const hasOldLocal = fs.existsSync(localPath) && fs.lstatSync(localPath).isSymbolicLink()

	if (hasOldLocal) {
		return {
			exists: true,
			isValid: false,
			isOldStructure: true,
			message: 'thoughts directory uses old structure (needs upgrade)',
		}
	}

	// Need config to check for user-specific symlinks
	if (!config) {
		return {
			exists: true,
			isValid: false,
			message: 'thoughts directory exists but configuration is missing',
		}
	}

	// Check for expected symlinks in new structure
	const userPath = path.join(thoughtsDir, config.user)
	const sharedPath = path.join(thoughtsDir, 'shared')
	const globalPath = path.join(thoughtsDir, 'global')

	const hasUser = fs.existsSync(userPath) && fs.lstatSync(userPath).isSymbolicLink()
	const hasShared = fs.existsSync(sharedPath) && fs.lstatSync(sharedPath).isSymbolicLink()
	const hasGlobal = fs.existsSync(globalPath) && fs.lstatSync(globalPath).isSymbolicLink()

	if (!hasUser || !hasShared || !hasGlobal) {
		return {
			exists: true,
			isValid: false,
			message: 'thoughts directory exists but symlinks are missing or broken',
		}
	}

	return { exists: true, isValid: true }
}

async function selectFromList(message: string, options: string[]): Promise<number> {
	if (message) {
		console.log(chalk.cyan(message))
	}
	options.forEach((opt, idx) => {
		console.log(`  [${idx + 1}] ${opt}`)
	})

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const answer = await prompt('Select option: ')
		const num = parseInt(answer)
		if (num >= 1 && num <= options.length) {
			return num - 1
		}
		console.log(chalk.red('Invalid selection. Please try again.'))
	}
}

function generateClaudeMd(thoughtsRepo: string, reposDir: string, repoName: string, user: string): string {
	const reposPath = path.join(thoughtsRepo, reposDir, repoName).replace(os.homedir(), '~')
	const globalPath = path.join(thoughtsRepo, 'global').replace(os.homedir(), '~')

	return `# Thoughts Directory Structure

This directory contains developer thoughts and notes for the ${repoName} repository.
It is managed by the HumanLayer thoughts system and should not be committed to the code repository.

## Structure

- \`${user}/\` → Your personal notes for this repository (symlink to ${reposPath}/${user})
- \`shared/\` → Team-shared notes for this repository (symlink to ${reposPath}/shared)
- \`global/\` → Cross-repository thoughts (symlink to ${globalPath})
  - \`${user}/\` - Your personal notes that apply across all repositories
  - \`shared/\` - Team-shared notes that apply across all repositories
- \`searchable/\` → Hard links for searching (auto-generated)

## Searching in Thoughts

The \`searchable/\` directory contains hard links to all thoughts files accessible in this repository. This allows search tools to find content without following symlinks.

**IMPORTANT**:
- Files in \`thoughts/searchable/\` are hard links to the original files (editing either updates both)
- For clarity and consistency, always reference files by their canonical path (e.g., \`thoughts/${user}/todo.md\`, not \`thoughts/searchable/${user}/todo.md\`)
- The \`searchable/\` directory is automatically updated when you run \`humanlayer thoughts sync\`

This design ensures that:
1. Search tools can find all your thoughts content easily
2. The symlink structure remains intact for git operations
3. Files remain editable while maintaining consistent path references

## Usage

Create markdown files in these directories to document:
- Architecture decisions
- Design notes
- TODO items
- Investigation results
- Any other development thoughts

Quick access:
- \`thoughts/${user}/\` for your repo-specific notes (most common)
- \`thoughts/global/${user}/\` for your cross-repo notes

These files will be automatically synchronized with your thoughts repository when you commit code changes.

## Important

- Never commit the thoughts/ directory to your code repository
- The git pre-commit hook will prevent accidental commits
- Use \`humanlayer thoughts sync\` to manually sync changes
- Use \`humanlayer thoughts status\` to see sync status
`
}

function setupGitHooks(repoPath: string): { updated: string[] } {
	const updated: string[] = []

	// Use git rev-parse to find the common git directory for hooks (handles worktrees)
	// In worktrees, hooks are stored in the common git directory, not the worktree-specific one
	let gitCommonDir: string
	try {
		gitCommonDir = execSync('git rev-parse --git-common-dir', {
			cwd: repoPath,
			encoding: 'utf8',
			stdio: 'pipe',
		}).trim()

		// If the path is relative, make it absolute
		if (!path.isAbsolute(gitCommonDir)) {
			gitCommonDir = path.join(repoPath, gitCommonDir)
		}
	} catch (error) {
		throw new Error(`Failed to find git common directory: ${error}`)
	}

	const hooksDir = path.join(gitCommonDir, 'hooks')

	// Ensure hooks directory exists (might not exist in some setups)
	if (!fs.existsSync(hooksDir)) {
		fs.mkdirSync(hooksDir, { recursive: true })
	}

	const HOOK_VERSION = '4' // Increment when hooks need updating - v4 uses Node.js for cross-platform

	// Install pre-commit hook using cross-platform Node.js implementation
	const preCommitContent = generatePreCommitHook(HOOK_VERSION)
	if (installGitHook(hooksDir, 'pre-commit', preCommitContent).updated) {
		updated.push('pre-commit')
	}

	// Install post-commit hook using cross-platform Node.js implementation
	const postCommitContent = generatePostCommitHook(HOOK_VERSION)
	if (installGitHook(hooksDir, 'post-commit', postCommitContent).updated) {
		updated.push('post-commit')
	}

	return { updated }
}

export async function thoughtsInitCommand(options: InitOptions): Promise<void> {
	try {
		const currentRepo = getCurrentRepoPath()

		// Check if we're in a git repository
		try {
			execSync('git rev-parse --git-dir', { stdio: 'pipe' })
		} catch {
			console.error(chalk.red('Error: Not in a git repository'))
			process.exit(1)
		}

		// Load or create global config first
		let config = loadThoughtsConfig(options)

		// If no config exists, we need to set it up first
		if (!config) {
			console.log(chalk.blue('=== Initial Thoughts Setup ==='))
			console.log('')
			console.log("First, let's configure your global thoughts system.")
			console.log('')

			// Get thoughts repository location
			const defaultRepo = getDefaultThoughtsRepo()
			console.log(chalk.gray('This is where all your thoughts across all projects will be stored.'))
			const thoughtsRepoInput = await prompt(`Thoughts repository location [${defaultRepo}]: `)
			const thoughtsRepo = thoughtsRepoInput || defaultRepo

			// Get directory names
			console.log('')
			console.log(chalk.gray('Your thoughts will be organized into two main directories:'))
			console.log(chalk.gray('- Repository-specific thoughts (one subdirectory per project)'))
			console.log(chalk.gray('- Global thoughts (shared across all projects)'))
			console.log('')

			const reposDirInput = await prompt(`Directory name for repository-specific thoughts [repos]: `)
			const reposDir = reposDirInput || 'repos'

			const globalDirInput = await prompt(`Directory name for global thoughts [global]: `)
			const globalDir = globalDirInput || 'global'

			// Get user name
			console.log('')
			const defaultUser = process.env.USER || 'user'
			let user = ''
			while (!user || user.toLowerCase() === 'global') {
				const userInput = await prompt(`Your username [${defaultUser}]: `)
				user = userInput || defaultUser
				if (user.toLowerCase() === 'global') {
					console.log(chalk.red('Username cannot be "global" as it\'s reserved for cross-project thoughts.'))
					user = ''
				}
			}

			config = {
				thoughtsRepo,
				reposDir,
				globalDir,
				user,
				repoMappings: {},
			}

			// Show what will be created
			console.log('')
			console.log(chalk.yellow('Creating thoughts structure:'))
			console.log(`  ${chalk.cyan(thoughtsRepo)}/`)
			console.log(`    ├── ${chalk.cyan(reposDir)}/     ${chalk.gray('(project-specific thoughts)')}`)
			console.log(`    └── ${chalk.cyan(globalDir)}/    ${chalk.gray('(cross-project thoughts)')}`)
			console.log('')

			// Ensure thoughts repo exists
			ensureThoughtsRepoExists(thoughtsRepo, reposDir, globalDir)

			// Save initial config
			saveThoughtsConfig(config, options)
			console.log(chalk.green('✅ Global thoughts configuration created'))
			console.log('')
		}

		// Validate profile if specified
		if (options.profile) {
			if (!validateProfile(config, options.profile)) {
				console.error(chalk.red(`Error: Profile "${options.profile}" does not exist.`))
				console.error('')
				console.error(chalk.gray('Available profiles:'))
				if (config.profiles) {
					Object.keys(config.profiles).forEach((name) => {
						console.error(chalk.gray(`  - ${name}`))
					})
				} else {
					console.error(chalk.gray('  (none)'))
				}
				console.error('')
				console.error(chalk.yellow('Create a profile first:'))
				console.error(chalk.gray(`  humanlayer thoughts profile create ${options.profile}`))
				process.exit(1)
			}
		}

		// Resolve profile config early so we use the right thoughtsRepo throughout
		// Create a temporary mapping to resolve the profile (will be updated later with actual mapping)
		const tempProfileConfig =
			options.profile && config.profiles && config.profiles[options.profile]
				? {
						thoughtsRepo: config.profiles[options.profile].thoughtsRepo,
						reposDir: config.profiles[options.profile].reposDir,
						globalDir: config.profiles[options.profile].globalDir,
						profileName: options.profile,
					}
				: {
						thoughtsRepo: config.thoughtsRepo,
						reposDir: config.reposDir,
						globalDir: config.globalDir,
						profileName: undefined,
					}

		// Now check for existing setup in current repo
		const setupStatus = checkExistingSetup(config)

		if (setupStatus.exists && !options.force) {
			if (setupStatus.isValid) {
				console.log(chalk.yellow('Thoughts directory already configured for this repository.'))
				const reconfigure = await prompt('Do you want to reconfigure? (y/N): ')
				if (reconfigure.toLowerCase() !== 'y') {
					console.log('Setup cancelled.')
					return
				}
			} else {
				console.log(chalk.yellow(`⚠️  ${setupStatus.message || 'Thoughts setup is incomplete'}`))

				if (setupStatus.isOldStructure) {
					console.log('')
					console.log(chalk.blue('The thoughts system has been upgraded to use a simpler structure:'))
					console.log(`  OLD: thoughts/local/${config.user}/`)
					console.log(`  NEW: thoughts/${config.user}/`)
					console.log('')
				}

				const fix = await prompt('Do you want to fix the setup? (Y/n): ')
				if (fix.toLowerCase() === 'n') {
					console.log('Setup cancelled.')
					return
				}
			}
		}

		// Ensure thoughts repo still exists (might have been deleted)
		const expandedRepo = expandPath(tempProfileConfig.thoughtsRepo)
		if (!fs.existsSync(expandedRepo)) {
			console.log(chalk.red(`Error: Thoughts repository not found at ${tempProfileConfig.thoughtsRepo}`))
			console.log(chalk.yellow('The thoughts repository may have been moved or deleted.'))
			const recreate = await prompt('Do you want to recreate it? (Y/n): ')
			if (recreate.toLowerCase() === 'n') {
				console.log('Please update your configuration or restore the thoughts repository.')
				process.exit(1)
			}
			ensureThoughtsRepoExists(
				tempProfileConfig.thoughtsRepo,
				tempProfileConfig.reposDir,
				tempProfileConfig.globalDir,
			)
		}

		// Map current repository
		const reposDir = path.join(expandedRepo, tempProfileConfig.reposDir)

		// Ensure repos directory exists
		if (!fs.existsSync(reposDir)) {
			fs.mkdirSync(reposDir, { recursive: true })
		}

		// Get existing repo directories
		const existingRepos = fs.readdirSync(reposDir).filter((name) => {
			const fullPath = path.join(reposDir, name)
			return fs.statSync(fullPath).isDirectory() && !name.startsWith('.')
		})

		// Check if current repo is already mapped
		let mappedName = config.repoMappings[currentRepo]

		if (!mappedName) {
			if (options.directory) {
				// Non-interactive mode with --directory option
				const sanitizedDir = sanitizeDirectoryName(options.directory)

				if (!existingRepos.includes(sanitizedDir)) {
					console.error(chalk.red(`Error: Directory "${sanitizedDir}" not found in thoughts repository.`))
					console.error(chalk.red('In non-interactive mode (--directory), you must specify a directory'))
					console.error(chalk.red('name that already exists in the thoughts repository.'))
					console.error('')
					console.error(chalk.yellow('Available directories:'))
					existingRepos.forEach((repo) => console.error(chalk.gray(`  - ${repo}`)))
					process.exit(1)
				}

				mappedName = sanitizedDir
				console.log(
					chalk.green(
						`✓ Using existing: ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/${mappedName}`,
					),
				)
			} else {
				// Interactive mode
				console.log(chalk.blue('=== Repository Setup ==='))
				console.log('')
				console.log(`Setting up thoughts for: ${chalk.cyan(currentRepo)}`)
				console.log('')
				console.log(
					chalk.gray(
						`This will create a subdirectory in ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/`,
					),
				)
				console.log(chalk.gray('to store thoughts specific to this repository.'))
				console.log('')

				if (existingRepos.length > 0) {
					console.log('Select or create a thoughts directory for this repository:')
					const options = [...existingRepos.map((repo) => `Use existing: ${repo}`), '→ Create new directory']
					const selection = await selectFromList('', options)

					if (selection === options.length - 1) {
						// Create new
						const defaultName = getRepoNameFromPath(currentRepo)
						console.log('')
						console.log(
							chalk.gray(
								`This name will be used for the directory: ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/[name]`,
							),
						)
						const nameInput = await prompt(`Directory name for this project's thoughts [${defaultName}]: `)
						mappedName = nameInput || defaultName

						// Sanitize the name
						mappedName = sanitizeDirectoryName(mappedName)
						console.log(
							chalk.green(
								`✓ Will create: ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/${mappedName}`,
							),
						)
					} else {
						mappedName = existingRepos[selection]
						console.log(
							chalk.green(
								`✓ Will use existing: ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/${mappedName}`,
							),
						)
					}
				} else {
					// No existing repos, just create new
					const defaultName = getRepoNameFromPath(currentRepo)
					console.log(
						chalk.gray(
							`This name will be used for the directory: ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/[name]`,
						),
					)
					const nameInput = await prompt(`Directory name for this project's thoughts [${defaultName}]: `)
					mappedName = nameInput || defaultName

					// Sanitize the name
					mappedName = sanitizeDirectoryName(mappedName)
					console.log(
						chalk.green(
							`✓ Will create: ${tempProfileConfig.thoughtsRepo}/${tempProfileConfig.reposDir}/${mappedName}`,
						),
					)
				}
			}

			console.log('')

			// Update config with profile-aware mapping
			if (options.profile) {
				config.repoMappings[currentRepo] = {
					repo: mappedName,
					profile: options.profile,
				}
			} else {
				// Keep string format for backward compatibility
				config.repoMappings[currentRepo] = mappedName
			}
			saveThoughtsConfig(config, options)
		}

		// Resolve profile config for directory creation
		const profileConfig = resolveProfileForRepo(config, currentRepo)

		// Create directory structure using profile config
		createThoughtsDirectoryStructure(profileConfig, mappedName, config.user)

		// Create thoughts directory in current repo
		const thoughtsDir = path.join(currentRepo, 'thoughts')
		if (fs.existsSync(thoughtsDir)) {
			// Handle searchable directories specially if they exist (might have read-only permissions)
			const searchableDir = path.join(thoughtsDir, 'searchable')
			const oldSearchDir = path.join(thoughtsDir, '.search')

			for (const dir of [searchableDir, oldSearchDir]) {
				if (fs.existsSync(dir)) {
					try {
						// Reset permissions so we can delete it
						removeReadOnly(dir)
					} catch {
						// Ignore errors
					}
				}
			}
			fs.rmSync(thoughtsDir, { recursive: true, force: true })
		}
		fs.mkdirSync(thoughtsDir)

		// Create directory links - flipped structure for easier access
		// Uses symlinks on Unix, junctions on Windows (no admin required)
		const repoTarget = getRepoThoughtsPath(profileConfig, mappedName)
		const globalTarget = getGlobalThoughtsPath(profileConfig)

		// Check for cross-drive scenario on Windows during init
		if (isWindows()) {
			const thoughtsDrive = path.parse(expandedRepo).root
			const codeDrive = path.parse(currentRepo).root
			if (thoughtsDrive !== codeDrive) {
				console.warn('')
				console.warn(chalk.yellow('⚠️  Warning: Thoughts repository and code are on different drives'))
				console.warn(chalk.yellow(`   Thoughts: ${thoughtsDrive}`))
				console.warn(chalk.yellow(`   Code: ${codeDrive}`))
				console.warn(chalk.yellow('   This may cause issues with hard links during sync.'))
				console.warn(chalk.yellow('   Consider moving thoughts repository to the same drive as your code.'))
				console.warn('')
			}
		}

		// Direct links to user and shared directories for repo-specific thoughts
		const userLink = await createDirectoryLink(
			path.join(repoTarget, config.user),
			path.join(thoughtsDir, config.user),
		)
		const sharedLink = await createDirectoryLink(path.join(repoTarget, 'shared'), path.join(thoughtsDir, 'shared'))

		// Global directory link
		const globalLink = await createDirectoryLink(globalTarget, path.join(thoughtsDir, 'global'))

		// Check if all links succeeded
		if (!userLink.success || !sharedLink.success || !globalLink.success) {
			console.error(chalk.red('Error: Failed to create directory links'))
			if (!userLink.success) console.error(chalk.red(`  User: ${userLink.message}`))
			if (!sharedLink.success) console.error(chalk.red(`  Shared: ${sharedLink.message}`))
			if (!globalLink.success) console.error(chalk.red(`  Global: ${globalLink.message}`))
			process.exit(1)
		}

		// Inform users about link type used
		if (isWindows()) {
			showLinkInfo()
		}

		// Check for other users and create symlinks
		const otherUsers = await updateSymlinksForNewUsers(currentRepo, profileConfig, mappedName, config.user)

		if (otherUsers.length > 0) {
			console.log(chalk.green(`✓ Added symlinks for other users: ${otherUsers.join(', ')}`))
		}

		// Pull latest thoughts if remote exists
		try {
			execSync('git remote get-url origin', { cwd: expandedRepo, stdio: 'pipe' })
			// Remote exists, try to pull
			try {
				execSync('git pull --rebase', {
					stdio: 'pipe',
					cwd: expandedRepo,
				})
				console.log(chalk.green('✓ Pulled latest thoughts from remote'))
			} catch (error) {
				console.warn(chalk.yellow('Warning: Could not pull latest thoughts:'), error.message)
			}
		} catch {
			// No remote configured, skip pull
		}

		// Generate CLAUDE.md
		const claudeMd = generateClaudeMd(profileConfig.thoughtsRepo, profileConfig.reposDir, mappedName, config.user)
		fs.writeFileSync(path.join(thoughtsDir, 'CLAUDE.md'), claudeMd)

		// Setup git hooks
		const hookResult = setupGitHooks(currentRepo)
		if (hookResult.updated.length > 0) {
			console.log(chalk.yellow(`✓ Updated git hooks: ${hookResult.updated.join(', ')}`))
		}

		// Link Claude Code setup if requested
		if (options.linkClaudeCode) {
			console.log('')
			console.log(chalk.blue('🔗 Linking Claude Code setup...'))

			try {
				// Auto-detect HumanLayer repo
				const claudeRepoPath = findHumanLayerRepo()
				if (!claudeRepoPath) {
					throw new Error('Could not find HumanLayer repository. Make sure it is installed or accessible.')
				}

				// Verify the source repository has the link_to_repo.sh script
				const linkScript = path.join(claudeRepoPath, 'hack', 'link_to_repo.sh')
				if (!fs.existsSync(linkScript)) {
					throw new Error(`link_to_repo.sh not found at ${linkScript}`)
				}

				// Execute the link script
				execSync(`bash "${linkScript}" "${currentRepo}"`, {
					stdio: 'inherit',
					cwd: claudeRepoPath,
				})

				// Automatically update .gitignore
				const gitignoreEntries = ['.claude/agents', '.claude/commands', 'hack/spec_metadata.sh']

				const gitignoreResult = updateGitIgnore(currentRepo, gitignoreEntries)

				if (gitignoreResult.added.length > 0) {
					console.log(chalk.green(`✓ Added to .gitignore: ${gitignoreResult.added.join(', ')}`))
				}

				if (gitignoreResult.skipped.length > 0) {
					console.log(chalk.yellow(`⚠️  Already in .gitignore: ${gitignoreResult.skipped.join(', ')}`))
				}

				console.log(chalk.green('✓ Claude Code setup linked'))
			} catch (error) {
				console.error(chalk.red(`✗ Failed to link Claude Code setup: ${error.message}`))
				console.error(chalk.yellow('You can manually link Claude Code setup later:'))
				console.error(chalk.gray(`  humanlayer thoughts link-claude-code`))
			}
		}

		console.log(chalk.green('✅ Thoughts setup complete!'))
		console.log('')
		console.log(chalk.blue('=== Summary ==='))
		console.log('')
		console.log('Repository structure created:')
		console.log(`  ${chalk.cyan(currentRepo)}/`)
		console.log(`    └── thoughts/`)
		console.log(
			`         ├── ${config.user}/     ${chalk.gray(`→ ${profileConfig.thoughtsRepo}/${profileConfig.reposDir}/${mappedName}/${config.user}/`)}`,
		)
		console.log(
			`         ├── shared/      ${chalk.gray(`→ ${profileConfig.thoughtsRepo}/${profileConfig.reposDir}/${mappedName}/shared/`)}`,
		)
		console.log(
			`         └── global/      ${chalk.gray(`→ ${profileConfig.thoughtsRepo}/${profileConfig.globalDir}/`)}`,
		)
		console.log(`             ├── ${config.user}/     ${chalk.gray('(your cross-repo notes)')}`)
		console.log(`             └── shared/  ${chalk.gray('(team cross-repo notes)')}`)
		console.log('')
		console.log('Protection enabled:')
		console.log(`  ${chalk.green('✓')} Pre-commit hook: Prevents committing thoughts/`)
		console.log(`  ${chalk.green('✓')} Post-commit hook: Auto-syncs thoughts after commits`)

		if (options.linkClaudeCode) {
			console.log(`  ${chalk.green('✓')} Claude Code setup linked (symlinks to .claude/ and hack/)`)
		}

		console.log('')
		console.log('Next steps:')
		console.log(`  1. Run ${chalk.cyan('humanlayer thoughts sync')} to create the searchable index`)
		console.log(`  2. Create markdown files in ${chalk.cyan(`thoughts/${config.user}/`)} for your notes`)
		console.log(`  3. Your thoughts will sync automatically when you commit code`)
		console.log(`  4. Run ${chalk.cyan('humanlayer thoughts status')} to check sync status`)
	} catch (error) {
		console.error(chalk.red(`Error during thoughts init: ${error}`))
		process.exit(1)
	}
}
